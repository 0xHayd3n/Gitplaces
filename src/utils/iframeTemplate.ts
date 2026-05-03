// src/utils/iframeTemplate.ts
import type { ParsedComponent } from './componentParser'

// ---------------------------------------------------------------------------
// stubLocalImports — used by Vue/Svelte paths where we don't have a CDN fallback.
// Stubs ALL imports (local + third-party) so the source can be inlined safely.
// ---------------------------------------------------------------------------
export function stubLocalImports(source: string): string {
  let result = source

  // 1. Side-effect imports first (catches 'import "pkg"' and 'import "./foo.css"')
  result = result.replace(/import\s+['"][^'"]+['"]\s*;?/g, '')

  // 2. Namespace imports: import * as X from '...'
  //    React is already a UMD global — just remove it
  result = result.replace(
    /import\s+\*\s+as\s+(\w+)\s+from\s+['"][^'"]+['"]\s*;?/g,
    (_m, name: string) => (name === 'React' ? '' : `const ${name} = {}`),
  )

  // 3. Mixed: import X, { Y, Z } from '...'
  result = result.replace(
    /import\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"][^'"]+['"]\s*;?/g,
    (_m, defName: string, namedPart: string) => {
      const clean = namedPart.replace(/\s+as\s+\w+/g, '')
      if (defName === 'React') return `const {${clean}} = {}`
      return `const ${defName} = {}\nconst {${clean}} = {}`
    },
  )

  // 4. Named imports: import { X, Y } from '...'
  //    Stub each name individually as a function so they work as components
  result = result.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"]\s*;?/g,
    (_m, names: string) =>
      names
        .split(',')
        .map(n => {
          const parts = n.trim().split(/\s+as\s+/)
          const finalName = (parts[1] ?? parts[0]).trim()
          return finalName ? `const ${finalName} = function(){}` : ''
        })
        .filter(Boolean)
        .join('\n'),
  )

  // 5. Default imports: import X from '...'
  //    React/ReactDOM are UMD globals — remove
  //    Local './...' or '../...': component placeholder
  //    Third-party: empty object stub
  result = result.replace(
    /import\s+(\w+)\s+from\s+(['"])([^'"]+)\2\s*;?/g,
    (_m, name: string, _q: string, path: string) => {
      if (name === 'React' || name === 'ReactDOM') return ''
      if (path.startsWith('./') || path.startsWith('../')) return `const ${name} = () => null`
      return `const ${name} = function(){}`
    },
  )

  // 6. Strip export keywords so the component is declared without module syntax
  //    export default function/class → just the declaration
  result = result.replace(/export\s+default\s+(function|class)\s/g, '$1 ')
  //    export default expression → remove (component is referenced by name from filename)
  result = result.replace(/export\s+default\s+\w+\s*;?/g, '')
  //    export named: export function/const/let/var/class/type/interface
  result = result.replace(/export\s+(function|const|let|var|class|type|interface|enum)\s/g, '$1 ')
  //    export { X, Y } blocks
  result = result.replace(/export\s+\{[^}]*\}\s*(?:from\s+['"][^'"]+['"])?\s*;?/g, '')

  return result
}

// ---------------------------------------------------------------------------
// Error bridge — injected into every iframe.
// Forwards JS errors and unhandled promise rejections to the parent window.
// Target '*' is intentional: blob-URL iframes have a null origin so we cannot
// use window.location.origin as the target.
// ---------------------------------------------------------------------------
const ERROR_BRIDGE = `<script>
window.onerror=function(m,s,l,c,e){
  var msg=e?(e.message+(e.stack?'\\n'+e.stack:'')):m;
  window.parent.postMessage({type:'render-error',message:String(msg)},'*');
  return true;
};
window.addEventListener('unhandledrejection',function(e){
  var r=e.reason;
  var msg=r instanceof Error?(r.message+(r.stack?'\\n'+r.stack:'')):String(r);
  window.parent.postMessage({type:'render-error',message:msg},'*');
});
</script>`

function escapeScriptContent(s: string): string {
  // Prevent </script> from closing the containing script tag
  return s.replace(/<\/script>/gi, '<\\/script>')
}

// ---------------------------------------------------------------------------
// prepareForCompile — used only in the React compile path.
//
// Unlike stubLocalImports (which stubs everything), this function:
//   • removes CSS / style side-effect imports that esbuild can't transform
//   • stubs LOCAL relative imports (we don't have those files)
//   • leaves ALL third-party bare specifiers unchanged so the import map
//     in the iframe can resolve them at runtime
//
// `stubReturn` controls what stubbed function imports return when called.
// The default `'null'` is the safest "rendered as nothing" choice for
// components used as JSX, but it makes destructuring throw — many libraries
// have utility helpers like `const { value } = parseLength(input)` that
// crash when stubbed as `() => null`. Passing `'_$stubEl'` (a React element
// defined in the iframe prolog) makes destructuring return undefined for
// any key while still being a valid React node when used as JSX.
// ---------------------------------------------------------------------------
function prepareForCompile(source: string, stubReturn: string = 'null'): string {
  let r = source

  // 1. Side-effect imports: import 'anything'  (CSS, SCSS, JSON, bare strings)
  r = r.replace(/^import\s+['"][^'"]+['"]\s*;?$/gm, '')

  // 2. Namespace: import * as X from './relative'
  r = r.replace(
    /^import\s+\*\s+as\s+(\w+)\s+from\s+(['"])(\.[^'"]+)\2\s*;?$/gm,
    (_m, name: string) => `const ${name} = {}`,
  )

  // 3. Mixed: import X, { Y } from './relative'
  r = r.replace(
    /^import\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+(['"])(\.[^'"]+)\3\s*;?$/gm,
    (_m, def: string, named: string) => {
      const stubs = named
        .split(',')
        .map((n: string) => {
          const fin = (n.trim().split(/\s+as\s+/).pop() ?? '').trim()
          return fin ? `const ${fin} = () => ${stubReturn}` : ''
        })
        .filter(Boolean)
        .join('\n')
      return `const ${def} = () => ${stubReturn}\n${stubs}`
    },
  )

  // 4. Named: import { X } from './relative'  (also strips import type { … })
  r = r.replace(
    /^import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+(['"])(\.[^'"]+)\2\s*;?$/gm,
    (_m, names: string) =>
      names
        .split(',')
        .map((n: string) => {
          const parts = n.trim().split(/\s+as\s+/)
          const fin = (parts[parts.length - 1] ?? '').trim()
          if (!fin || n.trim().startsWith('type ')) return ''
          return `const ${fin} = () => ${stubReturn}`
        })
        .filter(Boolean)
        .join('\n'),
  )

  // 5. Default: import X from './relative'
  r = r.replace(
    /^import\s+(\w+)\s+from\s+(['"])(\.[^'"]+)\2\s*;?$/gm,
    (_m, name: string) => `const ${name} = () => ${stubReturn}`,
  )

  // Third-party bare specifiers (not starting with '.') are left as-is.
  // esbuild's transform API does not bundle them — they remain bare specifiers
  // in the output, which the import map resolves at runtime.

  return r
}

// ---------------------------------------------------------------------------
// buildImportMap — scans compiled code for bare specifiers and generates a
// <script type="importmap"> that maps them to versioned esm.sh URLs.
//
// Key design decisions:
//   • react / react-dom are pinned to @18 so ALL modules share one instance.
//   • Third-party packages use ?external=react,react-dom which tells esm.sh to
//     leave those as bare imports (resolved by our map) instead of bundling
//     their own copy — preventing duplicate React instances.
// ---------------------------------------------------------------------------
const PINNED: Record<string, string> = {
  'react':                    'https://esm.sh/react@18',
  'react/jsx-runtime':        'https://esm.sh/react@18/jsx-runtime',
  'react/jsx-dev-runtime':    'https://esm.sh/react@18/jsx-dev-runtime',
  'react-dom':                'https://esm.sh/react-dom@18',
  'react-dom/client':         'https://esm.sh/react-dom@18/client',
  'react-dom/server':         'https://esm.sh/react-dom@18/server',
  'solid-js':                 'https://esm.sh/solid-js@1',
  'solid-js/web':             'https://esm.sh/solid-js@1/web',
  'solid-js/store':           'https://esm.sh/solid-js@1/store',
}

function buildImportMap(code: string): string {
  const imports: Record<string, string> = { ...PINNED }

  // Extract every bare specifier that appears after `from '…'`
  const re = /\bfrom\s+['"]([^'"./][^'"]*)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    const spec = m[1]!
    if (!imports[spec]) {
      // Pin to same React so the package doesn't bundle its own copy
      imports[spec] = `https://esm.sh/${spec}?external=react,react-dom`
    }
  }

  return `<script type="importmap">${JSON.stringify({ imports })}</script>`
}

// ---------------------------------------------------------------------------
// compileSource — calls esbuild in the main process via IPC with the given
// framework hint so the right loader/jsx settings are applied.
// ---------------------------------------------------------------------------
async function compileSource(source: string, framework: string): Promise<string | null> {
  try {
    const result = await window.api.components.compile(source, framework)
    if (result === null) {
      console.error('[ComponentExplorer] esbuild returned null — check DevTools for main-process errors')
    }
    return result
  } catch (e) {
    console.error('[ComponentExplorer] compileSource threw:', e)
    return null
  }
}

// ---------------------------------------------------------------------------
// stripExports — removes ES module export keywords from compiled code so that
// declarations are in scope by name (used by React, Solid, Angular, TS paths).
// ---------------------------------------------------------------------------
function stripExports(code: string, name: string): string {
  let c = code
  c = c.replace(/^export\s+default\s+(function\s+\w|class\s+\w)/gm, '$1')
  c = c.replace(/^export\s+default\s+(function|class)\b/gm, `const ${name} = $1`)
  c = c.replace(/^export\s+default\s+(\w[\w.]*)\s*;?\s*$/gm, (_m, id) =>
    id === name ? '' : `const ${name} = ${id}`)
  c = c.replace(/^export\s+default\s+/gm, '')
  c = c.replace(/^export\s+\{[^}]*\}(?:\s+from\s+['"][^'"]+['"])?\s*;?$/gm, '')
  c = c.replace(/^export\s+(function|const|let|var|class|type|interface|enum)\s/gm, '$1 ')
  return c
}

// ---------------------------------------------------------------------------
// buildIframeHtml — public entry point called by ComponentExplorer.
// ---------------------------------------------------------------------------
export async function buildIframeHtml(
  component: ParsedComponent,
  source: string,
  props: Record<string, unknown>,
  theme: 'light' | 'dark' = 'dark',
): Promise<string | null> {
  if (!component.renderable) return null
  const propsJson = JSON.stringify(props)
  switch (component.framework) {
    case 'react': {
      // Stubs default to `() => null`. We tried `_$stubEl` (a real React
      // element) so destructuring on helper-import return values would yield
      // undefined instead of throwing — but that caused React error #31
      // ("Objects are not valid as a React child") on a wide range of
      // libraries because component code uses stub return values in
      // contexts React validates strictly. The result was silent half-
      // renders that looked broken. Falling back to `null` makes failures
      // honest: destructuring throws → ComponentCard shows "Preview failed"
      // with the error message → user knows what's happening.
      const compiled = await compileSource(prepareForCompile(source), 'react')
      if (compiled === null) return null
      return buildReactHtml(component.name, compiled, propsJson, theme)
    }
    case 'solid': {
      const compiled = await compileSource(prepareForCompile(source), 'solid')
      if (compiled === null) return null
      return buildSolidHtml(component.name, compiled, propsJson, theme)
    }
    case 'vue':
      return buildVueHtml(component.name, stubLocalImports(source), propsJson, theme)
    case 'svelte':
      return buildSvelteHtml(stubLocalImports(source), propsJson, theme)
    case 'angular': {
      const compiled = await compileSource(prepareForCompile(source), 'angular')
      if (compiled === null) return null
      return buildAngularHtml(component.name, compiled, theme)
    }
    case 'typescript': {
      const compiled = await compileSource(prepareForCompile(source), 'typescript')
      if (compiled === null) return null
      return buildTypeScriptHtml(compiled, theme)
    }
    case 'javascript':
    case 'unknown':
      return buildJavaScriptHtml(source, theme)
    default:
      return null
  }
}

function themeStyle(theme: 'light' | 'dark'): string {
  return theme === 'dark'
    ? 'background:#0e0e0e;color:#eee'
    : 'background:#fff;color:#000'
}

function themeBodyAttrs(theme: 'light' | 'dark'): string {
  return `data-theme="${theme}"${theme === 'dark' ? ' class="dark"' : ''}`
}

function baseHead(theme: 'light' | 'dark', importMap = ''): string {
  // ERROR_BRIDGE must come before the importmap (which must come before module scripts).
  return `<meta charset="utf-8">${ERROR_BRIDGE}${importMap}
<style>body{margin:0;padding:16px;font-family:system-ui,sans-serif;${themeStyle(theme)}}</style>`
}

// ---------------------------------------------------------------------------
// buildReactHtml
//
// Takes esbuild-compiled ESM code (bare specifiers intact) and wraps it in a
// self-contained HTML document that:
//   1. Has an import map so bare specifiers resolve to esm.sh CDN URLs
//   2. Strips 'export default' so the component is in scope by name
//   3. Renders the component via React 18 createRoot
// ---------------------------------------------------------------------------
function buildReactHtml(name: string, compiledCode: string, propsJson: string, theme: 'light' | 'dark'): string {
  let code = stripExports(compiledCode, name)
  const importMap = buildImportMap(code)
  const renderTail = [
    `import{createElement as _$cc}from'react'`,
    `import{createRoot as _$cr}from'react-dom/client'`,
    `try{_$cr(document.getElementById('root')).render(_$cc(${name},${propsJson}));}` +
      `catch(e){window.parent.postMessage({type:'render-error',tier:'source',message:String(e)},'*');}`,
  ].join('\n')

  return `<!DOCTYPE html><html><head>${baseHead(theme, importMap)}
</head><body ${themeBodyAttrs(theme)}><div id="root"></div>
<script type="module">
${escapeScriptContent(code + '\n' + renderTail)}
</script></body></html>`
}

function buildVueHtml(name: string, source: string, propsJson: string, theme: 'light' | 'dark'): string {
  const templateMatch = source.match(/<template>([\s\S]+?)<\/template>/)
  const template = (templateMatch?.[1] ?? '<div>Component</div>')
    .replace(/<\/script>/gi, '<\\/script>')
    .replace(/`/g, '\\`')

  return `<!DOCTYPE html><html><head>
${baseHead(theme, '<script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>')}
</head><body ${themeBodyAttrs(theme)}><div id="app"></div>
<script>
const {createApp,ref,computed,reactive,watch,onMounted}=Vue;
const _props=${propsJson};
const _render=Vue.compile(\`${template}\`);
createApp({setup(){return _props},render:_render}).mount('#app');
</script></body></html>`
}

function buildSvelteHtml(source: string, propsJson: string, theme: 'light' | 'dark'): string {
  const escaped = source
    .replace(/\\/g, '\\\\')
    .replace(/<\/script>/gi, '<\\/script>')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')

  return `<!DOCTYPE html><html><head>
${baseHead(theme, '<script src="https://unpkg.com/svelte@4/compiler.js"></script>')}
</head><body ${themeBodyAttrs(theme)}>
<script type="module">
const src=\`${escaped}\`;
let compiled;
try{compiled=svelte.compile(src,{generate:'dom',format:'esm'});}
catch(e){window.parent.postMessage({type:'render-error',tier:'source',message:String(e)},'*');throw e;}
const blob=new Blob([compiled.js.code],{type:'application/javascript'});
const url=URL.createObjectURL(blob);
import(url).then(mod=>{
  new mod.default({target:document.body,props:${propsJson}});
}).catch(e=>{window.parent.postMessage({type:'render-error',tier:'source',message:String(e)},'*');});
</script></body></html>`
}

function buildSolidHtml(name: string, compiledCode: string, propsJson: string, theme: 'light' | 'dark'): string {
  const code = stripExports(compiledCode, name)
  const importMap = buildImportMap(code)
  const renderTail = [
    `import{render as _$r,createComponent as _$cc}from'solid-js/web'`,
    `try{_$r(()=>_$cc(${name},${propsJson}),document.getElementById('root'));}` +
    `catch(e){window.parent.postMessage({type:'render-error',tier:'source',message:String(e)},'*');}`,
  ].join('\n')
  return `<!DOCTYPE html><html><head>${baseHead(theme, importMap)}\n</head><body ${themeBodyAttrs(theme)}><div id="root"></div>\n<script type="module">\n${escapeScriptContent(code + '\n' + renderTail)}\n</script></body></html>`
}

function buildAngularHtml(name: string, compiledCode: string, theme: 'light' | 'dark'): string {
  const code = stripExports(compiledCode, name)
  return `<!DOCTYPE html><html><head>
${baseHead(theme, '<script src="https://unpkg.com/zone.js/dist/zone.js"></script>')}
</head><body ${themeBodyAttrs(theme)}><app-root></app-root>
<script type="module">
import{bootstrapApplication}from'https://esm.sh/@angular/platform-browser@17'
${escapeScriptContent(code)}
try{
  if(typeof ${name}!=='undefined'){
    bootstrapApplication(${name}).catch(function(e){window.parent.postMessage({type:'render-error',tier:'source',message:String(e)},'*');})
  }
}catch(e){window.parent.postMessage({type:'render-error',tier:'source',message:String(e)},'*');}
</script></body></html>`
}

function buildTypeScriptHtml(compiledCode: string, theme: 'light' | 'dark'): string {
  const code = stripExports(compiledCode, '')
  const importMap = buildImportMap(code)
  return `<!DOCTYPE html><html><head>${baseHead(theme, importMap)}\n</head><body ${themeBodyAttrs(theme)}><div id="root" style="padding:16px"></div>\n<script type="module">\n${escapeScriptContent(code)}\n</script></body></html>`
}

function buildJavaScriptHtml(source: string, theme: 'light' | 'dark'): string {
  const pluginMatch = source.match(/\$\.fn\.(\w+)\s*=/)
  const pluginName = pluginMatch?.[1] ?? null
  const autoInit = pluginName
    ? `try{if($.fn.${pluginName}){$('#demo').${pluginName}();}}catch(e){window.parent.postMessage({type:'render-error',tier:'source',message:String(e)},'*');}`
    : ''
  return `<!DOCTYPE html><html><head>
${baseHead(theme, '<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>')}
</head><body ${themeBodyAttrs(theme)}>
<div id="demo" style="padding:8px">
  <div class="accordion"><div class="title"><i class="dropdown icon"></i>Section 1</div><div class="content active"><p>Content</p></div></div>
</div>
<script>
${escapeScriptContent(source)}
${autoInit}
</script></body></html>`
}

// escapeScriptContent kept for potential use by callers
export { escapeScriptContent }

// ---------------------------------------------------------------------------
// buildBundledIframeHtml — bundled-tier renderer.
//
// Renders a component fetched directly from esm.sh (no local compilation).
// Uses a fixed import map for React 18 so the CDN module shares one instance.
// ---------------------------------------------------------------------------
import type { BundledRender } from '../types/components'

export function buildBundledIframeHtml(
  render: BundledRender,
  propsJson: string,
  theme: 'light' | 'dark',
): string {
  const importMap = `<script type="importmap">${JSON.stringify({
    imports: {
      'react':            'https://esm.sh/react@18',
      'react-dom':        'https://esm.sh/react-dom@18',
      'react-dom/client': 'https://esm.sh/react-dom@18/client',
      'react/jsx-runtime':'https://esm.sh/react@18/jsx-runtime',
    },
  })}</script>`

  const cssLinks = render.cssUrls
    .map(u => `<link rel="stylesheet" href="${u}" onerror="this.remove()">`)
    .join('')

  const themeAttr = `data-theme="${theme}"${theme === 'dark' ? ' class="dark"' : ''}`
  const themeStyle = theme === 'dark'
    ? 'background:#0e0e0e;color:#eee'
    : 'background:#fff;color:#000'

  const renderTail = [
    `import { ${render.exportName} as _$C } from '${render.importUrl}'`,
    `import { createElement } from 'react'`,
    `import { createRoot } from 'react-dom/client'`,
    `try {`,
    `  createRoot(document.getElementById('root')).render(createElement(_$C, ${propsJson}))`,
    `} catch (e) {`,
    `  window.parent.postMessage({type:'render-error',tier:'bundled',message:String(e)},'*')`,
    `}`,
  ].join('\n')

  return `<!DOCTYPE html><html><head><meta charset="utf-8">${ERROR_BRIDGE_BUNDLED}${importMap}${cssLinks}
<style>body{margin:0;padding:16px;font-family:system-ui,sans-serif;${themeStyle}}</style>
</head><body ${themeAttr}><div id="root"></div>
<script type="module">
${escapeScriptContent(renderTail)}
</script></body></html>`
}

const ERROR_BRIDGE_BUNDLED = `<script>
window.onerror=function(m,s,l,c,e){
  var msg=e?(e.message+(e.stack?'\\n'+e.stack:'')):m;
  window.parent.postMessage({type:'render-error',tier:'bundled',message:String(msg)},'*');
  return true;
};
window.addEventListener('unhandledrejection',function(e){
  var r=e.reason;
  var msg=r instanceof Error?(r.message+(r.stack?'\\n'+r.stack:'')):String(r);
  window.parent.postMessage({type:'render-error',tier:'bundled',message:msg},'*');
});
</script>`
