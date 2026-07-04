import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react'
import { createPortal } from 'react-dom'
import { Mail, Volume2, File, Globe } from 'lucide-react'
import gitplacesLogo from '../assets/logo-transparent.png'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkEmoji from 'remark-emoji'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { visit, SKIP } from 'unist-util-visit'
import type { Root, Element, ElementContent, Text } from 'hast'
import { classifyImage } from '../utils/imageClassifier'
import { detectImageNeedsInvert } from '../utils/detectImageNeedsInvert'
import { classifyLink } from '../utils/filePaths'
import { BADGE_DOMAINS, looksLikeBadgeUrl } from '../utils/badgeParser'
import { extractVideoId, fetchYouTubeOEmbed, type YouTubeVideoData } from '../utils/youtubeParser'
import { fetchLinkPreview, getCachedPreview } from '../utils/linkPreviewFetcher'
import type { LinkPreviewResult } from '../utils/linkPreviewFetcher'
import { parseGitHubRepoUrl } from '../utils/githubRepoUrl'
import { fetchRepoPreview, getCachedRepoPreview, type GitHubRepoPreview } from '../utils/githubRepoFetcher'
import { formatStars } from '../types/repo'
import { rehypeTtsAnnotate, type TtsAnnotation } from '../utils/rehypeTtsAnnotate'
import { useTtsReader } from '../hooks/useTtsReader'
import TtsPlaybackBar from './TtsPlaybackBar'
import { scrollTargetIntoView, type TocItem } from './TocNav'

// ── HAST text extraction helper ────────────────────────────────────
function extractNodeText(node: Element): string {
  return node.children
    .map(c => {
      if (c.type === 'text') return (c as Text).value
      if (c.type === 'element') return extractNodeText(c as Element)
      return ''
    })
    .join('')
}

// ── Rehype plugin: tag images with contextual classification signals ──
// Runs AFTER rehype-sanitize so data-* properties are not stripped.
function rehypeImageClassifier() {
  return (tree: Root) => {
    let lastHeadingText = ''

    visit(tree, 'element', (node: Element) => {
      // Track the most-recently-seen h2/h3 heading text
      if (node.tagName === 'h2' || node.tagName === 'h3') {
        lastHeadingText = extractNodeText(node)
        return
      }

      // Tag img children of <a> as linked, then skip subtree to avoid
      // visiting the img child again through the img branch below.
      if (node.tagName === 'a') {
        const imgChild = node.children.find(
          (c): c is Element => c.type === 'element' && (c as Element).tagName === 'img'
        )
        if (imgChild) {
          imgChild.properties = imgChild.properties ?? {}
          imgChild.properties.dataLinked = true
          imgChild.properties.dataHeadingCtx = lastHeadingText
        }
        return SKIP
      }

      // Tag every <img> with its heading context (linked imgs are already tagged
      // and skipped via SKIP in the <a> handler above)
      if (node.tagName === 'img') {
        node.properties = node.properties ?? {}
        if (node.properties.dataHeadingCtx === undefined) {
          node.properties.dataHeadingCtx = lastHeadingText
        }
        return
      }

      // Tag paragraphs whose non-whitespace content is entirely images
      if (node.tagName === 'p') {
        const significant = node.children.filter(
          c => !(c.type === 'text' && (c as Text).value.trim() === '')
        )
        if (significant.length === 0) return

        // Collect all img srcs (direct imgs or imgs inside <a>)
        const imgSrcs: string[] = []
        for (const c of significant) {
          if (c.type !== 'element') { imgSrcs.push('__non_img__'); continue }
          const el = c as Element
          if (el.tagName === 'img') {
            imgSrcs.push(String(el.properties?.src ?? ''))
          } else if (
            el.tagName === 'a' &&
            el.children.length === 1 &&
            el.children[0].type === 'element' &&
            (el.children[0] as Element).tagName === 'img'
          ) {
            imgSrcs.push(String((el.children[0] as Element).properties?.src ?? ''))
          } else {
            imgSrcs.push('__non_img__')
          }
        }

        if (imgSrcs.some(s => s === '__non_img__')) return

        // Badge row: all images are badge URLs (takes precedence over logo row)
        const allBadges = imgSrcs.every(s =>
          looksLikeBadgeUrl(s.replace(/^badge:\/\//, 'https://'))
        )
        if (allBadges) {
          node.properties = node.properties ?? {}
          node.properties.dataBadgeRow = true
          return
        }

        // Logo row: all images are linked (wrapped in <a>)
        const allLinkedImgs = significant.every(c => {
          if (c.type !== 'element') return false
          const el = c as Element
          return (
            el.tagName === 'a' &&
            el.children.length === 1 &&
            el.children[0].type === 'element' &&
            (el.children[0] as Element).tagName === 'img'
          )
        })
        if (allLinkedImgs) {
          node.properties = node.properties ?? {}
          node.properties.dataLogoRow = true
        }
      }
    })
  }
}

// ── Rehype plugin: remove locale-switcher paragraphs ─────────────
// Detects paragraphs whose only content is locale-language links
// (e.g. "English | 中文 | 日本語") and removes them entirely.
// These navigation aids are irrelevant when the app handles translation.

const LOCALE_LANG_NAMES = /^(?:english|中文|日本語|한국어|deutsch|français|español|português|русский|عربي|türkçe|italiano|polski|简体中文|繁體中文|traditional chinese|simplified chinese|bahasa indonesia|bahasa melayu|tiếng việt|ภาษาไทย|українська|čeština|română|nederlands|svenska|dansk|suomi|norsk|magyar|正體中文|हिन्दी|বাংলা|தமிழ்|اردو|فارسی|עברית|ελληνικά|日语)$/i

function isLocaleLink(el: Element): boolean {
  const href = String(el.properties?.href ?? '')
  const text = extractNodeText(el).trim()
  if (LOCALE_LANG_NAMES.test(text)) return true
  // href points to a README variant (e.g. README.zh-CN.md, README_EN.md)
  if (/readme[^/]*\.(md|rst|txt)$/i.test(href)) return true
  return false
}

function rehypeRemoveLocaleSwitcher() {
  return (tree: Root) => {
    ;(tree as any).children = tree.children.filter((node: any) => {
      if (node.type !== 'element' || (node as Element).tagName !== 'p') return true

      // Significant children = anything that isn't whitespace/separator text
      const significant = (node as Element).children.filter(
        c => !(c.type === 'text' && /^[\s|·•\/\-–—]+$/.test((c as Text).value))
      )

      if (significant.length < 2) return true  // need ≥ 2 locale options

      // Keep node unless ALL significant children are locale links
      return !significant.every(c => {
        if (c.type !== 'element') return false
        const el = c as Element
        return el.tagName === 'a' && isLocaleLink(el)
      })
    })
  }
}

// ── Rehype plugin: strip manual Table of Contents sections ───────
// Removes any heading whose text resolves to "table of contents", "contents",
// or "toc" (case-insensitive, ignoring leading emoji/punctuation) together with
// every sibling node that follows it up to the next heading of equal/higher rank.
// Runs after rehype-sanitize so we work on the clean tree, and before
// rehypeAddHeadingIds so no IDs or footnotes are generated for removed nodes.
//
// Uses filter + reassignment rather than splice — unified reconstructs the child
// array reference between passes, so in-place splice on tree.children is not
// reliably reflected downstream.
function isTocHeading(node: unknown): boolean {
  if ((node as any)?.type !== 'element') return false
  const el = node as Element
  if (!['h1', 'h2', 'h3', 'h4'].includes(el.tagName)) return false
  const text = extractNodeText(el).trim().toLowerCase().replace(/^[^\w]+/, '').replace(/[^\w]+$/, '').trim()
  return /^(table\s+of\s+)?contents?$|^toc$/.test(text)
}

function rehypeRemoveTocSection() {
  return (tree: Root) => {
    let inToc  = false
    let tocLevel = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(tree as any).children = tree.children.filter((node: any) => {
      if (node.type === 'element' && ['h1', 'h2', 'h3', 'h4'].includes(node.tagName)) {
        const level = parseInt(node.tagName[1])
        if (isTocHeading(node)) {
          inToc    = true
          tocLevel = level
          return false               // drop the ToC heading itself
        }
        if (inToc && level <= tocLevel) {
          inToc = false              // we've reached the next real section
          return true                // keep this heading
        }
      }
      return !inToc                  // drop everything while inside a ToC section
    })
  }
}

// ── Heading slug helper ───────────────────────────────────────────
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

// Strip a trailing ':' (plus any surrounding whitespace) from the rightmost
// text node inside a heading element — works recursively for nested inline elements.
function stripHeadingColon(node: Element): void {
  for (let i = node.children.length - 1; i >= 0; i--) {
    const child = node.children[i]
    if (child.type === 'text') {
      (child as Text).value = (child as Text).value.replace(/\s*:\s*$/, '')
      return
    }
    if (child.type === 'element') {
      stripHeadingColon(child as Element)
      return
    }
  }
}

// ── Rehype plugin: stamp slug IDs onto h1–h4 headings ────────────
// Also strips trailing ':' from heading text so label-style headings
// (e.g. "Installation:" → "Installation") render cleanly everywhere.
// Runs after rehype-sanitize so IDs are never stripped.
function rehypeAddHeadingIds() {
  return (tree: Root) => {
    const used = new Set<string>()
    visit(tree, 'element', (node: Element) => {
      if (!['h1', 'h2', 'h3', 'h4'].includes(node.tagName)) return
      // Strip colon BEFORE extracting text so slug + display are both clean
      if (extractNodeText(node).trimEnd().endsWith(':')) stripHeadingColon(node)
      const text = extractNodeText(node)
      let id = slugify(text)
      if (!id) return
      if (used.has(id)) {
        let n = 1
        while (used.has(`${id}-${n}`)) n++
        id = `${id}-${n}`
      }
      used.add(id)
      node.properties = { ...(node.properties ?? {}), id }
    })
  }
}

// ── Rehype plugin: tag YouTube links with video ID ──────────────────
// Runs AFTER rehype-sanitize so data-* properties are not stripped.
// Stamps data-yt-id on <a> elements and data-yt-ids on parent <p>.
function rehypeYouTubeLinks() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element, _index, parent) => {
      if (node.tagName !== 'a') return
      const href = String(node.properties?.href ?? '')
      const videoId = extractVideoId(href)
      if (!videoId) return

      // Stamp the video ID on the <a>
      node.properties = node.properties ?? {}
      node.properties.dataYtId = videoId

      // Stamp on parent <p> as comma-separated list
      if (parent && (parent as Element).tagName === 'p') {
        const p = parent as Element
        p.properties = p.properties ?? {}
        const existing = String(p.properties.dataYtIds ?? '')
        p.properties.dataYtIds = existing ? `${existing},${videoId}` : videoId
      }
    })
  }
}

// ── Rehype plugin: tag GitHub repo links with owner/name data attributes ──────
// Runs AFTER rehype-sanitize so data-* properties are not stripped.
// Stamps dataGhOwner and dataGhName on <a> elements that point to a GitHub
// repository root page (exactly two path segments). These links are handled
// separately in the `a` component override and excluded from footnote conversion.
function rehypeGitHubRepoLinks() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return
      const href = String(node.properties?.href ?? '')
      const parsed = parseGitHubRepoUrl(href)
      if (!parsed) return
      node.properties = node.properties ?? {}
      node.properties.dataGhOwner = parsed.owner
      node.properties.dataGhName  = parsed.name
      return SKIP
    })
  }
}

// ── Rehype plugin: tag internal blob links with data attribute + append file icon ──
// Identifies relative paths and same-repo GitHub URLs as internal blob links.
// Stamps dataBlobPath on <a> elements and appends a small file icon after link text.
function rehypeBlobLinks(repoOwner: string, repoName: string, basePath: string) {
  return () => (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return
      const href = String(node.properties?.href ?? '')

      // Skip anchors, YouTube links, and already-tagged GitHub repo links
      if (!href || href.startsWith('#')) return
      if (node.properties?.dataYtId) return
      if (node.properties?.dataGhOwner) return

      // Classify the link
      let isInternal = false
      let resolvedPath = ''

      // Check absolute GitHub URL for same repo
      const ghBlobMatch = href.match(
        /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(blob|tree)\/[^/]+\/(.+)$/
      )
      if (ghBlobMatch) {
        const [, owner, name, , path] = ghBlobMatch
        if (owner.toLowerCase() === repoOwner.toLowerCase() && name.toLowerCase() === repoName.toLowerCase()) {
          isInternal = true
          resolvedPath = path
        }
      }

      // Check relative paths (not http, not anchors, not mailto/tel/other protocols)
      if (!isInternal && !href.startsWith('http://') && !href.startsWith('https://') && !href.includes(':')) {
        isInternal = true
        // Resolve relative path
        let rel = href.replace(/^\.\//, '')
        const segments = basePath ? basePath.split('/') : []
        while (rel.startsWith('../')) {
          segments.pop()
          rel = rel.slice(3)
        }
        if (rel) segments.push(...rel.split('/'))
        resolvedPath = segments.join('/')
      }

      if (!isInternal) return

      node.properties = node.properties ?? {}
      node.properties.dataBlobPath = resolvedPath
    })
  }
}

// ── Derive a human-readable site name from a URL ─────────────────
function deriveSiteName(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return host.charAt(0).toUpperCase() + host.slice(1)
  } catch {
    return url
  }
}

// ── Rehype plugin: replace external links with footnote superscripts ──
// Runs AFTER rehype-sanitize so modifications aren't stripped.
function rehypeFootnoteLinks() {
  return (tree: Root) => {
    const refs: Array<{ n: number; href: string; text: string }> = []
    const hrefToN = new Map<string, number>()

    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'a') return
      const href = String(node.properties?.href ?? '')
      if (!href.startsWith('http://') && !href.startsWith('https://')) return

      // Skip links whose only children are images (linked-image rows)
      const allImages = node.children.length > 0 && node.children.every(
        c => c.type === 'element' && (c as Element).tagName === 'img'
      )
      if (allImages) return SKIP

      // Skip YouTube video links — they need the <a> element for the embed UI
      if (node.properties?.dataYtId) return SKIP

      // Skip GitHub repo links — they navigate in-app and must not become footnotes
      if (node.properties?.dataGhOwner) return SKIP

      // Assign footnote number — deduplicate same URL
      let n: number
      if (hrefToN.has(href)) {
        n = hrefToN.get(href)!
      } else {
        n = refs.length + 1
        const text = extractNodeText(node)
        refs.push({ n, href, text: text === href ? '' : text })
        hrefToN.set(href, n)
      }

      // Stamp the back-link id on the <a> itself so ↑ in the reference list still works.
      // No superscript is inserted — the text already hyperlinks directly to the target.
      node.properties = node.properties ?? {}
      node.properties.id = `fn-ref-${n}`
      return SKIP
    })

    if (refs.length === 0) return

    // Build APA-inspired references section and append to document
    const items: Element[] = refs.map(ref => {
      const siteName = deriveSiteName(ref.href)
      const citeText = ref.text
        ? `${siteName}. (n.d.). ${ref.text}. `
        : `${siteName}. (n.d.). `
      return {
        type: 'element',
        tagName: 'li',
        properties: { id: `fn-${ref.n}`, className: ['rm-reference-item'] },
        children: [
          { type: 'text', value: citeText },
          {
            type: 'element',
            tagName: 'a',
            properties: { href: ref.href, className: ['rm-reference-url', 'rm-link'] },
            children: [{ type: 'text', value: ref.href }],
          },
          { type: 'text', value: ' ' },
          {
            type: 'element',
            tagName: 'a',
            properties: { href: `#fn-ref-${ref.n}`, className: ['rm-reference-back'] },
            children: [{ type: 'text', value: '↑' }],
          },
        ],
      }
    })

    const section: Element = {
      type: 'element',
      tagName: 'section',
      properties: { className: ['rm-references'] },
      children: [
        {
          type: 'element',
          tagName: 'h2',
          properties: { className: ['rm-references-heading'], id: 'references' },
          children: [{ type: 'text', value: 'References' }],
        },
        {
          type: 'element',
          tagName: 'ol',
          properties: { className: ['rm-references-list'] },
          children: items,
        },
      ],
    }
    tree.children.push(section)
  }
}

// ── Rehype plugin: rescue content for an EMPTY center div ────────────────────
// Defense-in-depth fallback. The markdown preprocessing step `collapseHeroBlanks`
// usually keeps the entire <div align="center">...</div> as one HTML block, so the
// div arrives with its picture/h1/h3/links already inside. This plugin only kicks
// in for the rare case where the parser produced a truly empty center div (e.g.
// malformed source where the opening tag exists with nothing inside it).
//
// We DO NOT touch a div that already has content — doing so caused description
// paragraphs to be wrongly centered when the plugin absorbed them as siblings.
function rehypeFixCenterDivs() {
  return (tree: Root) => {
    const rootChildren = (tree as any).children as any[]

    for (let i = 0; i < rootChildren.length; i++) {
      const node = rootChildren[i] as Element
      if (node.type !== 'element') continue
      if (node.tagName !== 'div' && node.tagName !== 'center') continue

      const isCenter = node.tagName === 'center' || node.properties?.align === 'center'
      if (!isCenter) continue

      // Skip if div already has substantial content — preprocessing handled it.
      const hasContent = node.children.some(
        (c: any) => c.type === 'element' || (c.type === 'text' && (c as Text).value.trim() !== '')
      )
      if (hasContent) continue

      // Empty center div — absorb following siblings up to the next section heading
      // or another structural boundary, with a hard cap.
      const toMove: any[] = []
      let j = i + 1
      while (j < rootChildren.length && toMove.length < 8) {
        const sib = rootChildren[j] as Element
        if (
          sib.type === 'element' && sib.tagName === 'div' &&
          !sib.properties?.align &&
          !sib.children.some((c: any) => c.type === 'element' || (c.type === 'text' && (c as Text).value.trim() !== ''))
        ) {
          rootChildren.splice(j, 1)
          break
        }
        if (sib.type === 'element' && /^h[1-6]$/.test(sib.tagName) && toMove.length > 0) break
        toMove.push(sib)
        j++
      }

      if (toMove.length > 0) {
        node.children = toMove as any
        rootChildren.splice(i + 1, toMove.length)
      }
    }
  }
}

// ── Markdown preprocessing: collapse blank lines inside centered HTML blocks ──
// CommonMark ends type-6 HTML blocks at blank lines. When a README has
//   <div align="center">
//   <picture>…</picture>
//                                ← blank line: HTML block ends here
//   <h1>…</h1>                  ← becomes a SEPARATE block
//   …
//   </div>                       ← orphan closing tag, dropped by parse5
// the parsed HAST has the picture inside the div but h1/h3/p as outside siblings.
// rehypeFixCenterDivs would then have to guess where the hero ends and risk
// absorbing real body paragraphs (which centers them — incorrect).
//
// This pass scans for <div align="center"> / <center> openings, finds the matching
// closing tag with simple depth tracking, and removes blank lines in between so
// the entire centered region survives as ONE HTML block. Description paragraphs
// after </div> remain at the document root, correctly left-aligned.
function collapseHeroBlanks(src: string): string {
  const lines = src.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const isCenterOpen = /<(?:div\s+align=["']?center["']?[^>]*|center\b[^>]*)>/i.test(line)
    if (!isCenterOpen) {
      out.push(line)
      i++
      continue
    }
    const opens  = (line.match(/<(?:div|center)\b/gi)  || []).length
    const closes = (line.match(/<\/(?:div|center)>/gi) || []).length
    let depth = opens - closes
    const collected: string[] = [line]
    let j = i + 1
    const MAX_LOOKAHEAD = 200
    while (j < lines.length && depth > 0 && (j - i) < MAX_LOOKAHEAD) {
      const inner = lines[j]
      const innerOpens  = (inner.match(/<(?:div|center)\b/gi)  || []).length
      const innerCloses = (inner.match(/<\/(?:div|center)>/gi) || []).length
      depth += innerOpens - innerCloses
      // Skip blank lines while still inside the centered block
      if (depth > 0 && inner.trim() === '') { j++; continue }
      collected.push(inner)
      j++
    }
    if (depth <= 0) {
      out.push(...collected)
      i = j
    } else {
      // No matching close in range — leave original line, don't collapse
      out.push(line)
      i++
    }
  }
  return out.join('\n')
}

// ── Markdown preprocessing: convert markdown inside HTML blocks ──
// CommonMark does NOT process markdown inside HTML blocks (e.g. the content
// of `<div align="center">...</div>` is treated as raw HTML). GitHub's
// renderer deviates and DOES process markdown there; this rewrites the
// common patterns inside container blocks so the rendered output matches:
//   • image-in-link  `[![alt](img)](href)` → `<a href><img/></a>`  (badges)
//   • standalone img `![alt](url)`         → `<img/>`
//   • simple link    `[text](url)`         → `<a href>text</a>`
//   • atx heading    `# text`              → `<h1>text</h1>`       (line-anchored)
// Order matters: image-in-link first so the inner `![](...)` doesn't get
// matched as a standalone image, and links last so any remaining `[](url)`
// patterns aren't confused with image syntax.
function convertMdInHtmlBlocks(src: string): string {
  const blockPattern = /(<(p|div|center|h[1-6]|sub|sup|td|th)(?:\s[^>]*)?>)([\s\S]*?)(<\/\2>)/gi
  return src.replace(blockPattern, (full, openTag, _tag, content: string, closeTag) => {
    // Quick reject: skip if the content has no markdown markers we'd convert
    if (!/\[[^\]]*\]\([^)]+\)|^[ \t]*#{1,6} /m.test(content)) return full

    let processed = content

    // 1. Image-in-link: [![alt](img)](href)
    processed = processed.replace(
      /\[!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
      (_m, alt: string, imgUrl: string, linkUrl: string) =>
        `<a href="${linkUrl}"><img src="${imgUrl}" alt="${alt}" /></a>`
    )

    // 2. Standalone image: ![alt](url)
    processed = processed.replace(
      /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
      (_m, alt: string, url: string) => `<img src="${url}" alt="${alt}" />`
    )

    // 3. Simple link: [text](url)
    processed = processed.replace(
      /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
      (_m, text: string, url: string) => `<a href="${url}">${text}</a>`
    )

    // 4. ATX heading at line start: `# text`, `## text`, ... `###### text`
    processed = processed.replace(
      /^[ \t]*(#{1,6})[ \t]+([^\n]+?)[ \t]*$/gm,
      (_m, hashes: string, text: string) => `<h${hashes.length}>${text}</h${hashes.length}>`
    )

    return openTag + processed + closeTag
  })
}

// ── Rehype plugin: stamp image-only <a> elements ──────────────────────────
// Runs BEFORE rehype-sanitize so data-* properties survive sanitization.
// Purpose: lets the `a` component override skip the link preview popover
// for linked images. Note: rehypeFootnoteLinks already has its own allImages
// guard — this stamp is only for the render-time popover guard.
function rehypeImageOnlyLinks() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return
      const significant = node.children.filter(
        c => !(c.type === 'text' && (c as Text).value.trim() === '')
      )
      const allImages = significant.length > 0 && significant.every(
        c => c.type === 'element' && (c as Element).tagName === 'img'
      )
      if (allImages) {
        node.properties = node.properties ?? {}
        ;(node.properties as any)['data-img-only'] = true
      }
    })
  }
}

// Extend the default sanitization schema to allow common GitHub README attributes
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [
      ...(defaultSchema.attributes?.['*'] ?? []),
      'align',
      'width',
      'height',
    ],
    img:    [...(defaultSchema.attributes?.img ?? []), 'src', 'alt', 'width', 'height', 'align'],
    a:      [...(defaultSchema.attributes?.a   ?? []), 'href', 'title'],
    // hast-util-sanitize matches by HAST property name (camelCase), not HTML attribute name.
    // 'srcset' (lowercase) would be stripped → picture sources lose their image URL → logo missing.
    source: ['srcSet', 'media', 'type', 'sizes'],
    div:    ['align', 'class'],
    p:   ['align'],
    td:  ['align', 'valign'],
    th:  ['align', 'valign'],
    svg: ['width', 'height', 'viewBox', 'fill', 'stroke', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'className', 'style'],
    path: ['d'],
    polyline: ['points'],
  },
  protocols: {
    ...defaultSchema.protocols,
    // Allow badge:// scheme so rewritten badge URLs survive sanitisation
    src: [...(defaultSchema.protocols?.src ?? []), 'badge'],
  },
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'div', 'span', 'center', 'sub', 'sup',
    'details', 'summary',
    'picture', 'source',
    'svg', 'path', 'polyline',
  ],
}

// ── GitHub asset media — img with <video> fallback ────────────────
// GitHub converts uploaded GIFs to MP4 and serves them at github.com/*/assets/* URLs.
// <img> can't display MP4, so on error we swap to <video autoplay loop muted>.
function GitHubAssetMedia({ src, alt }: { src: string; alt: string }) {
  const [useVideo, setUseVideo] = useState(false)

  if (useVideo) {
    return (
      <video
        src={src}
        autoPlay
        loop
        muted
        playsInline
        className="rm-img-content rm-gh-asset-video"
        onError={(e) => { (e.target as HTMLVideoElement).style.display = 'none' }}
      />
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      className="rm-img-content"
      loading="lazy"
      onError={() => setUseVideo(true)}
    />
  )
}

// ── Copy-enabled code block ────────────────────────────────────────
function CodeBlock({ children }: { children: React.ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    const text = preRef.current?.textContent ?? ''
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <div className="rm-pre-wrap">
      <pre ref={preRef} className="rm-pre">{children}</pre>
      <button
        className={`rm-copy-btn${copied ? ' copied' : ''}`}
        onClick={handleCopy}
        title={copied ? 'Copied!' : 'Copy to clipboard'}
      >
        {copied ? (
          // Checkmark
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
            <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/>
          </svg>
        ) : (
          // Copy icon
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
            <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/>
            <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
          </svg>
        )}
      </button>
    </div>
  )
}

interface LightboxState { src: string; alt: string }

// ── Link preview popover ──────────────────────────────────────────────────
// `data` may be a skeleton (empty title/description/image + derived domain)
// on first hover of an uncached URL — the popover is shown immediately and
// the parent triggers a re-render once the IPC fetch populates the cache.

function makeSkeletonPreview(url: string): LinkPreviewResult {
  let domain = ''
  try { domain = new URL(url).hostname } catch { /* ignore */ }
  return { title: '', description: '', imageUrl: '', faviconUrl: '', domain }
}

interface LinkPreviewPopoverProps {
  url:          string
  rect:         DOMRect | null
  data:         LinkPreviewResult
  onMouseEnter: () => void
  onMouseLeave: () => void
}

const GLOBE_SVG = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="8" cy="8" r="6.5" />
    <path d="M8 1.5C6 4 5 6 5 8s1 4 3 6.5M8 1.5C10 4 11 6 11 8s-1 4-3 6.5M1.5 8h13" />
  </svg>
)

function LinkPreviewPopover({ url, rect, data, onMouseEnter, onMouseLeave }: LinkPreviewPopoverProps) {
  const hasContent = !!(data.title || data.description || data.imageUrl)
  return (
    <div
      className="rm-yt-popover rm-link-popover"
      style={{ top: (rect?.bottom ?? 0) + 6, left: rect?.left ?? 0 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {data.imageUrl && (
        <img
          src={data.imageUrl}
          alt=""
          className="rm-link-popover-image"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      )}
      <div className="rm-link-popover-meta">
        {data.faviconUrl ? (
          <img
            src={data.faviconUrl}
            alt=""
            className="rm-link-popover-favicon"
            onError={(e) => { (e.target as HTMLImageElement).replaceWith(document.createElementNS('http://www.w3.org/2000/svg', 'svg')) }}
          />
        ) : (
          <span className="rm-link-popover-favicon">{GLOBE_SVG}</span>
        )}
        <span className="rm-link-popover-domain">{data.domain}</span>
      </div>
      {hasContent && data.title && (
        <div className="rm-link-popover-title">{data.title}</div>
      )}
      {hasContent && data.description && (
        <div className="rm-link-popover-desc">{data.description}</div>
      )}
      <div className="rm-link-popover-url">{url}</div>
    </div>
  )
}

// ── GitHub repo hover popover ─────────────────────────────────────────────────

interface GitHubRepoPopoverProps {
  ownerName:    string
  rect:         DOMRect | null
  data:         GitHubRepoPreview
  onMouseEnter: () => void
  onMouseLeave: () => void
}

function GitHubRepoPopover({ ownerName, rect, data, onMouseEnter, onMouseLeave }: GitHubRepoPopoverProps) {
  return (
    <div
      className="rm-yt-popover rm-gh-repo-popover"
      style={{ top: (rect?.bottom ?? 0) + 6, left: rect?.left ?? 0 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="rm-gh-repo-popover-header">
        {data.avatarUrl && (
          <img
            src={data.avatarUrl}
            alt=""
            className="rm-gh-repo-popover-avatar"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        )}
        <span className="rm-gh-repo-popover-name">{ownerName}</span>
      </div>
      {data.description && (
        <div className="rm-gh-repo-popover-desc">{data.description}</div>
      )}
      {data.stars > 0 && (
        <div className="rm-gh-repo-popover-stars">★ {formatStars(data.stars)}</div>
      )}
    </div>
  )
}

function TheatreEmbed({ videoId }: { videoId: string }) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  if (error) {
    return (
      <div className="rm-yt-theatre rm-yt-theatre-error">
        <p>Video unavailable.</p>
        <a
          className="rm-link"
          href={`https://www.youtube.com/watch?v=${videoId}`}
          onClick={(e) => {
            e.preventDefault()
            window.api.openExternal(`https://www.youtube.com/watch?v=${videoId}`)
          }}
        >
          Open on YouTube
        </a>
      </div>
    )
  }

  return (
    <div className="rm-yt-theatre">
      {!loaded && <div className="rm-yt-theatre-loading" />}
      <iframe
        src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
        sandbox="allow-scripts allow-same-origin allow-presentation"
        allow="autoplay; encrypted-media"
        allowFullScreen
        title="YouTube video player"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        style={loaded ? undefined : { opacity: 0, position: 'absolute' }}
      />
    </div>
  )
}

// ── Memoised wrapper around ReactMarkdown ─────────────────────────────
// react-markdown v10 has no internal memoisation — every render re-parses
// the source and re-runs the entire rehype plugin pipeline. Hover-driven
// state changes in the parent (hoverLink, hoverGhRepo, linkPreviewTick)
// were therefore triggering a full re-parse on every mouse movement.
// React.memo with shallow prop comparison short-circuits when none of the
// stable, memoised inputs have changed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface MemoizedMarkdownProps {
  content: string
  components: Record<string, any>
  remarkPlugins: any[]
  rehypePlugins: any[]
  urlTransform: (url: string) => string
}
const MemoizedMarkdown = memo(function MemoizedMarkdown({
  content, components, remarkPlugins, rehypePlugins, urlTransform,
}: MemoizedMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      urlTransform={urlTransform}
      components={components}
    >
      {content}
    </ReactMarkdown>
  )
})

interface Props {
  content: string
  repoOwner: string
  repoName: string
  branch?: string
  basePath?: string
  onNavigateToFile?: (path: string) => void
  onTocReady?: (headings: TocItem[]) => void
  readmeBodyRef?: React.RefObject<HTMLDivElement>
  invertDarkImages?: boolean
}

function ReadmeRenderer({ content, repoOwner, repoName, branch = 'main', basePath = '', onNavigateToFile, onTocReady, readmeBodyRef, invertDarkImages = false }: Props) {
  const [lightbox, setLightbox] = useState<LightboxState | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Callback ref: attach to .readme-body, and also populate external readmeBodyRef
  // so RepoDetail can pass that element to the external TocNav as headingsContainerRef.
  const setContainerRef = useCallback((el: HTMLDivElement | null) => {
    (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el
    if (readmeBodyRef) {
      (readmeBodyRef as React.MutableRefObject<HTMLDivElement | null>).current = el
    }
  }, [readmeBodyRef])

  const prevHeadingIds = useRef<string>('')

  useEffect(() => {
    if (!onTocReady) return
    const container = containerRef.current
    if (!container) return

    // Wait one frame for ReactMarkdown to populate the DOM with headings
    const rafId = requestAnimationFrame(() => {
      const domHeadings = Array.from(
        container.querySelectorAll('h2[id], h3[id]')
      ) as HTMLElement[]

      let lastH2Id: string | null = null
      const items: TocItem[] = []
      for (const h of domHeadings) {
        const text = h.textContent?.trim() ?? ''
        if (!text) continue
        const level = parseInt(h.tagName[1])
        if (level === 2) lastH2Id = h.id
        items.push({ id: h.id, text, level, parentId: level === 3 ? lastH2Id : null })
      }

      // Only notify parent when the heading list actually changes
      // (prevents infinite re-render loops on unrelated re-renders)
      const idKey = items.map(i => i.id).join(',')
      if (idKey !== prevHeadingIds.current) {
        prevHeadingIds.current = idKey
        onTocReady(items)
      }
    })
    return () => cancelAnimationFrame(rafId)
  }, [content, onTocReady])

  const statusBarRef = useRef<HTMLDivElement>(null)
  // Footnote click history — up to 5 entries; index 0 = most recently visited
  const [fnHistory, setFnHistory] = useState<number[]>([])

  // ── TTS state ──
  const ttsOutput = useRef<TtsAnnotation>({ sentences: [], sections: [] })
  const [ttsReady, setTtsReady] = useState(false)

  const navigate = useNavigate()

  // GitHub repo hover popover state
  const [hoverGhRepo,     setHoverGhRepo]     = useState<string | null>(null)  // "owner/name"
  const [hoverGhRepoRect, setHoverGhRepoRect] = useState<DOMRect | null>(null)
  const ghHoverTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentGhHoverRef = useRef<string | null>(null)

  // ── YouTube video embed state ──
  const [activeVideo, setActiveVideo] = useState<string | null>(null)
  const [hoverVideo, setHoverVideo] = useState<{ id: string; rect: DOMRect } | null>(null)
  const ytCache = useRef<Map<string, YouTubeVideoData>>(new Map())
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Link preview popover state — independent from the YouTube popover system
  const [hoverLink, setHoverLink]         = useState<string | null>(null)
  const [hoverLinkRect, setHoverLinkRect] = useState<DOMRect | null>(null)
  // Bumped when an async fetchLinkPreview resolves so the popover re-reads the cache.
  const [, setLinkPreviewTick]            = useState(0)
  const linkHoverTimerRef                  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentHoverHrefRef                = useRef<string | null>(null)

  // Close lightbox on Escape
  useEffect(() => {
    if (!lightbox) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lightbox])

  // Status bar: track which link is hovered using native event delegation.
  // Native mouseover/mouseout bubble reliably in both browser and JSDOM,
  // avoiding issues with React 18's synthetic onMouseLeave in test environments.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const setStatus = (url: string | null) => {
      const bar = statusBarRef.current
      if (!bar) return
      if (url) {
        bar.textContent = url
        bar.style.display = 'block'
      } else {
        bar.style.display = 'none'
        bar.textContent = ''
      }
    }

    let lastAnchor: HTMLAnchorElement | null = null
    const handleOver = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a') as HTMLAnchorElement | null
      if (anchor === lastAnchor) return
      lastAnchor = anchor
      if (anchor && el.contains(anchor)) {
        const url = anchor.getAttribute('href') ?? ''
        setStatus(url.startsWith('http://') || url.startsWith('https://') ? url : null)
      } else {
        setStatus(null)
      }
    }

    const handleOut = (e: MouseEvent) => {
      const relatedTarget = e.relatedTarget as HTMLElement | null
      const target = e.target as HTMLElement
      const anchor = target.closest('a')
      if (anchor && el.contains(anchor)) {
        // Only clear if the pointer is leaving the anchor entirely
        if (!relatedTarget || !anchor.contains(relatedTarget)) {
          setStatus(null)
        }
      }
    }

    el.addEventListener('mouseover', handleOver)
    el.addEventListener('mouseout', handleOut)
    return () => {
      el.removeEventListener('mouseover', handleOver)
      el.removeEventListener('mouseout', handleOut)
    }
  }, [])

  // Clean up link preview hover timer on unmount
  useEffect(() => {
    return () => {
      if (linkHoverTimerRef.current) clearTimeout(linkHoverTimerRef.current)
    }
  }, [])

  // Clean up GitHub hover timer on unmount
  useEffect(() => {
    return () => { if (ghHoverTimerRef.current) clearTimeout(ghHoverTimerRef.current) }
  }, [])

  // Wait for speechSynthesis voices to load
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    const check = () => {
      if (speechSynthesis.getVoices().length > 0) setTtsReady(true)
    }
    check()
    speechSynthesis.onvoiceschanged = check
    return () => { speechSynthesis.onvoiceschanged = null }
  }, [])

  // Stop TTS playback when content changes (e.g. repo switch, translation toggle).
  // Annotation arrays are cleared by rehypeTtsAnnotate itself on each render pass,
  // so we no longer need to replace the ref object (which previously orphaned
  // freshly-populated data due to useEffect running after the render).
  useEffect(() => {
    tts.stop()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  const tts = useTtsReader(
    ttsReady ? ttsOutput.current.sentences : [],
    ttsReady ? ttsOutput.current.sections : [],
    containerRef,
  )

  // Step 1 + 2: fix relative paths and rewrite badge URLs — memoised so this only
  // runs when content/repo props actually change, not on every fnHistory update.
  const rewrittenContent = useMemo(() => {
    // Step 0: strip any manual "Table of Contents" / "Contents" / "TOC" section
    // directly from the markdown text before remark parses it.  This is the most
    // reliable pass — the HAST plugin below handles HTML-embedded headings as a
    // second line of defence.
    const noToc = (() => {
      const lines  = content.split('\n')
      const out: string[] = []
      let inToc    = false
      let tocLevel = 0
      for (const line of lines) {
        const m = line.match(/^(#{1,4})\s+(.+?)\s*$/)
        if (m) {
          const level = m[1].length
          const text  = m[2].toLowerCase().replace(/^[^\w]+/, '').replace(/[^\w]+$/, '').trim()
          if (/^(table\s+of\s+)?contents?$|^toc$/.test(text)) {
            inToc    = true
            tocLevel = level
            continue                     // drop the heading line
          }
          if (inToc && level <= tocLevel) inToc = false  // back to normal content
        }
        if (!inToc) out.push(line)
      }
      return out.join('\n')
    })()

    // Step 0b: strip content before the first h2+ heading ONLY when the preamble
    // is thin (just an h1, badges, and blank lines). Repos like Daytona have
    // meaningful prose paragraphs before the first h2 — those must be kept.
    const noPreamble = (() => {
      const lines = noToc.split('\n')

      // Find the first h2+ ATX heading or setext h2 (--- underline)
      let h2Idx = -1
      for (let i = 0; i < lines.length; i++) {
        if (/^#{2,6}\s/.test(lines[i])) { h2Idx = i; break }
        if (lines[i].trim() && i + 1 < lines.length && /^-{3,}\s*$/.test(lines[i + 1])) {
          h2Idx = i; break
        }
      }

      if (h2Idx > 0) {
        // Check whether the preamble contains prose text (starts with a letter,
        // length > 10, not a heading). Badge lines are already stripped by the
        // badge parser before this component runs.
        const hasProse = lines.slice(0, h2Idx).some(line => {
          const t = line.trim()
          if (!t) return false
          // Prose text starting with a letter
          if (t.length > 10 && /^[a-zA-Z\u00C0-\u024F]/.test(t)) return true
          // HTML blocks (hero sections, logo blocks) are meaningful preamble
          if (t.startsWith('<') && t.length > 3) return true
          return false
        })
        if (!hasProse) return lines.slice(h2Idx).join('\n')
        return noToc  // meaningful preamble — keep everything
      }

      // No h2 found: fallback to first heading of any level
      for (let i = 0; i < lines.length; i++) {
        if (/^#{1,6}\s/.test(lines[i])) return lines.slice(i).join('\n')
        if (lines[i].trim() && i + 1 < lines.length && /^={3,}\s*$/.test(lines[i + 1])) {
          return lines.slice(i).join('\n')
        }
      }
      return noToc
    })()

    // Step 0c: collapse blank lines inside <div align="center">...</div> so
    // CommonMark keeps the entire hero section as one HTML block. Without this,
    // h1/h3/p siblings end up outside the div and cannot be reliably reattached.
    const heroCollapsed = collapseHeroBlanks(noPreamble)

    // Step 0d: rewrite markdown inside HTML blocks (links, images, image-in-link
    // badges, atx headings) to HTML so they actually render — CommonMark doesn't
    // process markdown inside HTML blocks, but GitHub's renderer does.
    const linksRewritten = convertMdInHtmlBlocks(heroCollapsed)

    // Step 1: fix relative image paths → absolute GitHub raw URLs
    const fixedContent = linksRewritten
      .replace(
        /!\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g,
        (_, alt, src) =>
          `![${alt}](https://raw.githubusercontent.com/${repoOwner}/${repoName}/${branch}/${src.replace(/^\.\//, '')})`
      )
      .replace(
        /src="(?!https?:\/\/)([^"]+)"/g,
        (_, src) =>
          `src="https://raw.githubusercontent.com/${repoOwner}/${repoName}/${branch}/${src.replace(/^\.\//, '')}"`
      )
      // Step 1b: fix relative srcset paths (for <source> elements inside <picture> blocks)
      .replace(
        /srcset="([^"]+)"/g,
        (match, srcset) => {
          const fixed = srcset.replace(
            /(^|,\s*)(?!https?:\/\/)(\S+)/g,
            (_: string, prefix: string, url: string) =>
              `${prefix}https://raw.githubusercontent.com/${repoOwner}/${repoName}/${branch}/${url.replace(/^\.\//, '')}`
          )
          return fixed !== srcset ? `srcset="${fixed}"` : match
        }
      )
      // Step 1c: convert github.com blob URLs for images to raw.githubusercontent.com
      // GitHub renders these transparently on their site but they return HTML in <img> tags
      .replace(
        /!\[([^\]]*)\]\(https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/([^)]+)\)/g,
        (_, alt, owner, repo, br, path) =>
          `![${alt}](https://raw.githubusercontent.com/${owner}/${repo}/${br}/${path})`
      )
      .replace(
        /src="https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/([^"]+)"/g,
        (_, owner, repo, br, path) =>
          `src="https://raw.githubusercontent.com/${owner}/${repo}/${br}/${path}"`
      )

    // Step 2: rewrite badge image URLs https:// → badge://
    return fixedContent
      .replace(
        /!\[([^\]]*)\]\((https:\/\/[^)]+)\)/g,
        (match, alt, url) => {
          try {
            const { hostname } = new URL(url)
            if (BADGE_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))) {
              return `![${alt}](${url.replace(/^https:\/\//, 'badge://')})`
            }
          } catch { /* ignore malformed URLs */ }
          return match
        }
      )
      .replace(
        /<img([^>]*)\ssrc="(https:\/\/[^"]+)"([^>]*)>/gi,
        (match, before, url, after) => {
          try {
            const { hostname } = new URL(url)
            if (BADGE_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))) {
              return `<img${before} src="${url.replace(/^https:\/\//, 'badge://')}"${after}>`
            }
          } catch { /* ignore malformed URLs */ }
          return match
        }
      )
  }, [content, repoOwner, repoName, branch])

  // Prefetch link previews as they scroll into view
  useEffect(() => {
    if (!containerRef.current || typeof IntersectionObserver === 'undefined') return
    const container = containerRef.current
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const href = (entry.target as HTMLAnchorElement).href
        if (href && !getCachedPreview(href)) fetchLinkPreview(href)
      }
    }, { threshold: 0 })

    const links = container.querySelectorAll<HTMLAnchorElement>(
      'a[href^="http"]:not([data-yt-id]):not([data-img-only]):not([data-gh-owner])'
    )
    links.forEach(el => {
      // Skip image-only links (contributor grids, avatar rows, etc.) — no preview needed
      if (el.children.length === 1 && el.children[0].tagName === 'IMG') return
      observer.observe(el)
    })

    // Prefetch GitHub repo metadata for all repo links visible in this render
    const ghLinks = container.querySelectorAll<HTMLAnchorElement>('a[data-gh-owner]')
    ghLinks.forEach(el => {
      const owner = el.getAttribute('data-gh-owner')
      const name  = el.getAttribute('data-gh-name')
      if (owner && name && !getCachedRepoPreview(owner, name)) {
        fetchRepoPreview(owner, name)   // fire-and-forget cache warming
      }
    })

    return () => observer.disconnect()
  }, [rewrittenContent])

  // Helper to extract plain text from React children (handles inline markup like `## Getting **Started**`)
  function extractChildText(children: React.ReactNode): string {
    if (typeof children === 'string') return children
    if (Array.isArray(children)) return children.map(extractChildText).join('')
    if (children && typeof children === 'object' && 'props' in children) {
      return extractChildText((children as any).props.children)
    }
    return ''
  }

  // Stable plugin arrays + urlTransform so the memoised <ReactMarkdown> wrapper
  // can short-circuit re-renders when only hover/preview state changes.
  // remarkPlugins never depends on props; rehypePlugins changes only when the
  // repo identity changes (rehypeBlobLinks closes over owner/name/basePath).
  // ttsOutput.current is a stable ref → safe to omit from rehypePlugins deps.
  const remarkPlugins = useMemo(
    () => [remarkGfm, [remarkEmoji, { accessible: false }]],
    [],
  )
  const rehypePlugins = useMemo(
    () => [
      rehypeRaw,
      [rehypeSanitize, sanitizeSchema],
      rehypeFixCenterDivs,
      rehypeRemoveTocSection,
      rehypeRemoveLocaleSwitcher,
      rehypeImageClassifier,
      rehypeAddHeadingIds,
      rehypeYouTubeLinks,
      rehypeGitHubRepoLinks,
      rehypeBlobLinks(repoOwner, repoName, basePath),
      rehypeFootnoteLinks,
      rehypeImageOnlyLinks,
      [rehypeTtsAnnotate, { output: ttsOutput.current }],
    ],
    [repoOwner, repoName, basePath],
  )
  const urlTransform = useCallback(
    (url: string) => url.startsWith('badge://') ? url : defaultUrlTransform(url),
    [],
  )

  // Memoised components map — only recreated when fnHistory changes (footnote highlights).
  // Prevents ReactMarkdown from re-rendering on every scroll-driven activeId update
  // (which now lives solely inside TocNav and never touches this component's state).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mdComponents = useMemo<Record<string, any>>(() => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    h1: ({ children, id }: any) => {
      // Apply the flex wrap class only when a TTS button is actually rendered.
      // Unconditional `display: flex` on every heading breaks centered layouts
      // (e.g. `<div align="center"># <img> Taiga UI</div>`) because flex
      // ignores `text-align: center`.
      const showTts = ttsReady && ttsOutput.current.sentences.length > 0
      return (
        <h1 id={id} className={`rm-h1${showTts ? ' tts-heading-wrap' : ''}`}>
          {children}
          {showTts && (
            <button
              className="tts-heading-btn"
              onClick={() => tts.play(0)}
              title="Read aloud"
            >
              <Volume2 size={18} />
            </button>
          )}
        </h1>
      )
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    h2: ({ children, id, className: extraClass }: any) => {
      const text = extractChildText(children)
      const section = ttsOutput.current.sections.find(s => s.headingText === text)
      const showTts = ttsReady && Boolean(section)
      const cls = ['rm-h2', showTts ? 'tts-heading-wrap' : null, extraClass].filter(Boolean).join(' ')
      return (
        <h2 id={id} className={cls}>
          {children}
          {showTts && (
            <button
              className="tts-heading-btn"
              onClick={() => tts.play(section!.sentenceIndex)}
              title="Read from here"
            >
              <Volume2 size={14} />
            </button>
          )}
        </h2>
      )
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    h3: ({ children, id }: any) => {
      const text = extractChildText(children)
      const section = ttsOutput.current.sections.find(s => s.headingText === text)
      const showTts = ttsReady && Boolean(section)
      return (
        <h3 id={id} className={`rm-h3${showTts ? ' tts-heading-wrap' : ''}`}>
          {children}
          {showTts && (
            <button
              className="tts-heading-btn"
              onClick={() => tts.play(section!.sentenceIndex)}
              title="Read from here"
            >
              <Volume2 size={14} />
            </button>
          )}
        </h3>
      )
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    h4: ({ children, id }: any) => <h4 id={id} className="rm-h4">{children}</h4>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p: ({ children, node }: any) => {
      const ttsSentence = node?.properties?.dataTtsSentence as string | undefined
      if (node?.properties?.dataBadgeRow === true) {
        return null  // badges are shown in the sidebar; suppress inline badge rows
      }
      if (node?.properties?.dataLogoRow === true) {
        return <p className="rm-logo-row" data-tts-sentence={ttsSentence}>{children}</p>
      }

      // Check if this paragraph contains the currently-active YouTube video
      const ytIds = String(node?.properties?.dataYtIds ?? '')
      const showTheatre = activeVideo && ytIds.split(',').includes(activeVideo)

      return (
        <>
          <p className="rm-p" data-tts-sentence={ttsSentence}>{children}</p>
          {showTheatre && (
            <TheatreEmbed videoId={activeVideo} />
          )}
        </>
      )
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    a: ({ href, children, className: nodeClass, node }: any) => {
      const ytId = node?.properties?.dataYtId as string | undefined

      // YouTube link — render with play/stop toggle and hover preview
      if (ytId) {
        const isPlaying = activeVideo === ytId
        return (
          <span
            className="rm-yt-link-wrap"
            onMouseEnter={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
              hoverTimerRef.current = setTimeout(() => {
                setHoverVideo({ id: ytId, rect })
                // Fetch oEmbed data if not cached
                if (!ytCache.current.has(ytId)) {
                  fetchYouTubeOEmbed({ videoId: ytId, playlistId: null, url: href ?? '' })
                    .then(data => {
                      ytCache.current.set(ytId, data)
                      // Force re-render to show fetched data
                      setHoverVideo(prev => prev?.id === ytId ? { ...prev } : prev)
                    })
                }
              }, 300)
            }}
            onMouseLeave={() => {
              if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
              hoverTimerRef.current = setTimeout(() => setHoverVideo(null), 200)
            }}
          >
            <a
              className="rm-link rm-yt-link"
              href={href}
              data-yt-id={ytId}
              onClick={(e) => {
                e.preventDefault()
                if (href) window.api.openExternal(href)
              }}
            >
              {children}
            </a>
            <button
              className={`rm-yt-play-btn${isPlaying ? ' rm-yt-playing' : ''}`}
              aria-label={isPlaying ? 'Stop video' : 'Play video'}
              onClick={(e) => {
                e.stopPropagation()
                setActiveVideo(isPlaying ? null : ytId)
              }}
            >
              {isPlaying ? (
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="3" y="3" width="10" height="10" rx="1" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4 2l10 6-10 6z" />
                </svg>
              )}
            </button>
          </span>
        )
      }

      // ── GitHub repository link — navigate in-app ─────────────────────
      const ghOwner = node?.properties?.dataGhOwner as string | undefined
      const ghName  = node?.properties?.dataGhName  as string | undefined

      if (ghOwner && ghName) {
        return (
          <a
            className="rm-link rm-gh-repo-link"
            href={href}
            data-gh-owner={ghOwner}
            data-gh-name={ghName}
            onClick={(e) => {
              e.preventDefault()
              navigate(`/repo/${ghOwner}/${ghName}`)
            }}
            onMouseEnter={(e) => {
              setHoverGhRepo(null)
              const key = `${ghOwner}/${ghName}`
              currentGhHoverRef.current = key
              if (ghHoverTimerRef.current) clearTimeout(ghHoverTimerRef.current)
              const el = e.currentTarget as HTMLElement
              fetchRepoPreview(ghOwner, ghName) // start IPC immediately
              ghHoverTimerRef.current = setTimeout(async () => {
                const rect = el.getBoundingClientRect()
                await fetchRepoPreview(ghOwner, ghName)
                if (currentGhHoverRef.current === key) {
                  setHoverGhRepo(key)
                  setHoverGhRepoRect(rect)
                }
              }, 50)
            }}
            onMouseLeave={() => {
              currentGhHoverRef.current = null
              if (ghHoverTimerRef.current) clearTimeout(ghHoverTimerRef.current)
              ghHoverTimerRef.current = setTimeout(() => setHoverGhRepo(null), 80)
            }}
          >
            {children}
            <img src={gitplacesLogo} alt="" className="rm-gh-link-gitplaces-icon" />
          </a>
        )
      }

      // Internal blob link — navigate to Files tab
      const blobPath = (node?.properties as any)?.dataBlobPath as string | undefined
      if (blobPath && onNavigateToFile) {
        return (
          <a
            className={nodeClass ?? 'rm-link'}
            href={href}
            data-blob-path={blobPath}
            onClick={(e) => {
              e.preventDefault()
              onNavigateToFile(blobPath)
            }}
          >
            {children}
            <File size={12} className="rm-file-link-icon" />
          </a>
        )
      }

      // Reference-list URL — render with a small favicon prefix
      if (String(nodeClass ?? '').includes('rm-reference-url')) {
        let faviconSrc = (href ? getCachedPreview(href)?.faviconUrl : undefined) ?? ''
        if (!faviconSrc && href) {
          try { faviconSrc = `${new URL(href).origin}/favicon.ico` } catch { /**/ }
        }
        return (
          <a className={nodeClass} href={href} onClick={(e) => {
            e.preventDefault()
            if (href) window.api.openExternal(href)
          }}>
            {faviconSrc && (
              <img src={faviconSrc} alt="" className="rm-ref-favicon"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
            )}
            {children}
          </a>
        )
      }

      // Default non-YouTube link behavior (unchanged from existing code)
      const hasImgOnly = (node?.properties as any)?.['data-img-only'] === true
      // fnRefId is set by rehypeFootnoteLinks on external inline links (e.g. "fn-ref-1").
      // We pass it through to the DOM so the ↑ back-link can target it, and we use it
      // to update footnote-visit history when the user clicks the link.
      const fnRefId = (node?.properties?.id as string | undefined)
      const isExternal = href
        ? href.startsWith('http://') || href.startsWith('https://')
        : false
      return (
        <a
          className={nodeClass ?? 'rm-link'}
          href={href}
          {...(fnRefId ? { id: fnRefId } : {})}
          {...(hasImgOnly ? { 'data-img-only': true } : {})}
          onClick={(e) => {
            e.preventDefault()
            if (!href) return
            if (href.startsWith('http://') || href.startsWith('https://')) {
              // Check if this is an internal GitHub URL for the same repo
              const linkInfo = classifyLink(href, basePath, repoOwner, repoName)
              if (linkInfo.type === 'internal' && linkInfo.resolvedPath && onNavigateToFile) {
                onNavigateToFile(linkInfo.resolvedPath)
                return
              }
              // Track visit in footnote history when link has a fn-ref-N id
              if (fnRefId?.startsWith('fn-ref-')) {
                const n = parseInt(fnRefId.slice(7), 10)
                if (!isNaN(n)) {
                  setFnHistory(prev => {
                    const filtered = prev.filter(x => x !== n)
                    return [n, ...filtered].slice(0, 5)
                  })
                }
              }
              window.api.openExternal(href)
            } else if (href.startsWith('#')) {
              const target = document.getElementById(href.slice(1))
              if (target) scrollTargetIntoView(target)
              if (href.startsWith('#fn-ref-') && target) {
                target.classList.remove('rm-fn-ref-flash')
                void target.offsetWidth
                target.classList.add('rm-fn-ref-flash')
                setTimeout(() => target.classList.remove('rm-fn-ref-flash'), 1650)
              }
            } else if (href.startsWith('mailto:') || href.startsWith('tel:')) {
              window.api.openExternal(href)
            } else if (onNavigateToFile) {
              // Relative path — resolve and navigate
              const linkInfo = classifyLink(href, basePath, repoOwner, repoName)
              if (linkInfo.type === 'internal' && linkInfo.resolvedPath) {
                onNavigateToFile(linkInfo.resolvedPath)
              }
            }
          }}
          {...(isExternal && !hasImgOnly ? {
            onMouseEnter: (e: React.MouseEvent) => {
              currentHoverHrefRef.current = href!
              if (linkHoverTimerRef.current) clearTimeout(linkHoverTimerRef.current)
              const el = e.currentTarget as HTMLElement
              const key = href!
              fetchLinkPreview(key)
              linkHoverTimerRef.current = setTimeout(() => {
                if (currentHoverHrefRef.current !== key) return
                setHoverLink(key)
                setHoverLinkRect(el.getBoundingClientRect())
                if (!getCachedPreview(key)) {
                  fetchLinkPreview(key).then(() => {
                    if (currentHoverHrefRef.current === key) {
                      setLinkPreviewTick(n => n + 1)
                    }
                  })
                }
              }, 50)
            },
            onMouseLeave: () => {
              currentHoverHrefRef.current = null
              if (linkHoverTimerRef.current) clearTimeout(linkHoverTimerRef.current)
              linkHoverTimerRef.current = setTimeout(() => setHoverLink(null), 80)
            },
          } : {})}
        >
          {href?.startsWith('mailto:') && <Mail size={12} className="rm-mail-icon" />}
          {children}
          {isExternal && !hasImgOnly && <Globe size={12} className="rm-ext-link-icon" />}
        </a>
      )
    },
    pre: ({ children }: any) => <CodeBlock>{children}</CodeBlock>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    code: ({ className, children }: any) =>
      className
        ? <code className={className}>{children}</code>
        : <code className="rm-code-inline">{children}</code>,
    ul:         ({ children }: any) => <ul className="rm-ul">{children}</ul>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ol:         ({ children, className: nodeClass }: any) => <ol className={nodeClass ?? 'rm-ol'}>{children}</ol>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    li: ({ children, className: nodeClass, id, node }: any) => {
      const ttsSentence = node?.properties?.dataTtsSentence as string | undefined
      // For reference list items (id="fn-N"), append the history-position class
      let historyClass = ''
      if (id && id.startsWith('fn-') && !id.startsWith('fn-ref-')) {
        const n = parseInt(id.slice(3), 10)
        if (!isNaN(n)) {
          const pos = fnHistory.indexOf(n)
          if (pos !== -1) historyClass = ` rm-fn-active-${pos}`
        }
      }
      return <li id={id} className={(nodeClass ?? 'rm-li') + historyClass} data-tts-sentence={ttsSentence}>{children}</li>
    },
    blockquote: ({ children }: any) => <blockquote className="rm-blockquote">{children}</blockquote>,
    hr:         () => <hr className="rm-hr" />,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    img: ({ src, alt, node }: any) => {
      // Badge images: render inline at fixed height (src was rewritten to badge:// in preprocessing)
      if (src?.startsWith('badge://')) {
        return (
          <img src={src} alt={alt ?? ''} className="rm-img-badge" loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        )
      }

      // GitHub asset URLs (github.com/*/assets/* and private-user-images) are often
      // served as MP4 video — use a component that falls back from <img> to <video>
      const isGhAsset = /github\.com\/[^/]+\/[^/]+\/assets\/|private-user-images\.githubusercontent\.com\//.test(src ?? '')
      if (isGhAsset) {
        return <GitHubAssetMedia src={src ?? ''} alt={alt ?? ''} />
      }

      // Existing classification logic follows unchanged
      const isLinked = node?.properties?.dataLinked === true
      const headingCtx = (node?.properties?.dataHeadingCtx as string) ?? ''

      // Parse width — distinguish percentage (e.g. "40%") from pixel values.
      // Percentage widths must be applied as inline CSS style; class CSS (width:auto)
      // would otherwise override the HTML attribute.
      const rawWidth  = node?.properties?.width
      const widthStr  = String(rawWidth ?? '')
      const isPctW    = widthStr.endsWith('%')
      const declaredWidth  = isPctW ? undefined : (typeof rawWidth === 'number' ? rawWidth : parseInt(widthStr) || undefined)
      const declaredHeight = typeof node?.properties?.height === 'number' ? node.properties.height : parseInt(String(node?.properties?.height ?? '')) || undefined
      const pctStyle: React.CSSProperties = isPctW ? { width: widthStr, maxWidth: '100%' } : {}

      const treatment = classifyImage({ src: src ?? '', isLinked, nearestHeadingText: headingCtx, declaredWidth, declaredHeight })

      if (treatment === 'logo') {
        return (
          <img src={src} alt={alt ?? ''} className="rm-img-logo" loading="lazy"
            style={pctStyle}
            {...(declaredHeight ? { height: declaredHeight } : {})}
            {...(!isPctW && declaredWidth ? { width: declaredWidth } : {})}
            onLoad={invertDarkImages ? (e) => {
              const el = e.target as HTMLImageElement
              if (detectImageNeedsInvert(el)) el.setAttribute('data-needs-invert', 'true')
            } : undefined}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        )
      }

      return (
        <img src={src} alt={alt ?? ''} className="rm-img-content" loading="lazy"
          style={pctStyle}
          {...(declaredHeight ? { height: declaredHeight } : {})}
          {...(!isPctW && declaredWidth ? { width: declaredWidth } : {})}
          onClick={() => src && setLightbox({ src, alt: alt ?? '' })}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          onLoad={(e) => {
            const el = e.target as HTMLImageElement
            if (el.naturalHeight > 0 && el.naturalWidth / el.naturalHeight > 3 && el.naturalHeight < 80) {
              el.className = 'rm-img-logo'
              el.onclick = null
            }
            if (invertDarkImages && detectImageNeedsInvert(el)) {
              el.setAttribute('data-needs-invert', 'true')
            }
          }}
        />
      )
    },
    table: ({ children }: any) => (
      <div className="rm-table-wrap">
        <table className="rm-table">{children}</table>
      </div>
    ),
    th: ({ children }: any) => <th className="rm-th">{children}</th>,
    td: ({ children }: any) => <td className="rm-td">{children}</td>,
  // navigate, setHoverGhRepo, setHoverGhRepoRect: stable references (React Router / useState setters) — intentionally excluded
  // tts.play/pause/etc are stable useCallback references; ttsReady changes once (voices loaded)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // hoverVideo was a phantom dep — only setHoverVideo is called inside, never read.
  // Removing it lets MemoizedMarkdown skip re-renders when YouTube hover state flips.
  }), [fnHistory, activeVideo, ttsReady, invertDarkImages]) // only re-create when footnote, YouTube, or TTS-ready state changes

  return (
    <div className={`readme-body${tts.status !== 'idle' ? ' tts-playing' : ''}`} ref={setContainerRef}>
      <div className="rm-body-row">
      <div className="rm-content">
        <MemoizedMarkdown
          content={rewrittenContent}
          components={mdComponents}
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          urlTransform={urlTransform}
        />
      </div>
      </div> {/* end .rm-body-row */}

      <TtsPlaybackBar
        status={tts.status}
        speed={tts.speed}
        autoScroll={tts.autoScroll}
        sections={tts.sections}
        sentences={ttsOutput.current.sentences}
        sentenceStore={tts.sentenceStore}
        onPlay={() => tts.play()}
        onPause={tts.pause}
        onResume={tts.resume}
        onStop={tts.stop}
        onSetSpeed={tts.setSpeed}
        onToggleAutoScroll={tts.toggleAutoScroll}
        onJumpToCurrent={tts.jumpToCurrent}
        onPlayFrom={(si) => tts.play(si)}
      />

      {lightbox && (
        <div className="rm-lightbox" onClick={() => setLightbox(null)}>
          <div className="rm-lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <img
              src={lightbox.src}
              alt={lightbox.alt}
              className="rm-lightbox-img"
            />
            {lightbox.alt && <p className="rm-lightbox-caption">{lightbox.alt}</p>}
          </div>
        </div>
      )}

      {/* YouTube hover popover — portalled to body to escape backdrop-filter containing block */}
      {hoverVideo && (() => {
        const data = ytCache.current.get(hoverVideo.id)
        return createPortal(
          <div
            className="rm-yt-popover"
            style={{
              top: hoverVideo.rect.bottom + 6,
              left: hoverVideo.rect.left,
            }}
            onMouseEnter={() => {
              if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
            }}
            onMouseLeave={() => {
              hoverTimerRef.current = setTimeout(() => setHoverVideo(null), 200)
            }}
          >
            {data?.thumbnailUrl && (
              <img src={data.thumbnailUrl} alt={data.title} className="rm-yt-popover-thumb" />
            )}
            <div className="rm-yt-popover-info">
              <div className="rm-yt-popover-title">{data?.title || 'YouTube Video'}</div>
              {data?.author && <div className="rm-yt-popover-author">{data.author}</div>}
            </div>
          </div>,
          document.body,
        )
      })()}

      {/* Link preview popover — portalled to body */}
      {hoverLink && createPortal(
        <LinkPreviewPopover
          url={hoverLink}
          rect={hoverLinkRect}
          data={getCachedPreview(hoverLink) ?? makeSkeletonPreview(hoverLink)}
          onMouseEnter={() => {
            if (linkHoverTimerRef.current) clearTimeout(linkHoverTimerRef.current)
          }}
          onMouseLeave={() => {
            linkHoverTimerRef.current = setTimeout(() => setHoverLink(null), 80)
          }}
        />,
        document.body,
      )}

      {/* GitHub repo hover popover — portalled to body */}
      {hoverGhRepo && (() => {
        const [ghO, ghN] = hoverGhRepo.split('/')
        const data = getCachedRepoPreview(ghO, ghN)
        if (!data) return null
        return createPortal(
          <GitHubRepoPopover
            ownerName={hoverGhRepo}
            rect={hoverGhRepoRect}
            data={data}
            onMouseEnter={() => {
              if (ghHoverTimerRef.current) clearTimeout(ghHoverTimerRef.current)
            }}
            onMouseLeave={() => {
              ghHoverTimerRef.current = setTimeout(() => setHoverGhRepo(null), 80)
            }}
          />,
          document.body,
        )
      })()}

      <div className="rm-status-bar" ref={statusBarRef} style={{ display: 'none' }} />
    </div>
  )
}

export default memo(ReadmeRenderer, (prev, next) =>
  prev.content === next.content &&
  prev.repoOwner === next.repoOwner &&
  prev.repoName === next.repoName &&
  prev.branch === next.branch &&
  prev.onNavigateToFile === next.onNavigateToFile &&
  prev.onTocReady === next.onTocReady &&
  prev.readmeBodyRef === next.readmeBodyRef &&
  prev.invertDarkImages === next.invertDarkImages
)
