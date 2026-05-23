# Repository as Data (RAD)
## A Compositional Skill System for Mapping Repositories

---

## 1. Concept

**Repository as Data (RAD)** treats source repositories not as static codebases but as inputs to a structured knowledge-extraction pipeline. Every repository contributes evidence along three independent dimensions — **Language**, **Type**, and **Topic** — that combine to produce a single, portable artifact: an `.ltt` file describing what the repository is, what it does, and how it fits into the broader technological landscape.

The goal is to replace ad-hoc, prose-based repository understanding (READMEs, scattered documentation, training-data inference) with a compositional, machine-comparable representation.

---

## 2. The Three Skill Dimensions

| Dimension | What it captures | Scope | Identifier |
|-----------|------------------|-------|------------|
| **Language Skill** | What language, framework, or runtime parameters apply (set by a Language Source) | Global | 5-digit code |
| **Type Skill** | The general category or pattern — a public aggregate refined across many repositories | Global, public | embedded in 10-digit code |
| **Topic Skill** | The specific, targeted subject matter a particular repository contributes | Local at first, may promote | embedded in 10-digit code |

Each dimension can be enriched independently. Language is parameter-driven (set by a Language Source). Topic is repository-driven (each repo contributes targeted topic signal). Type is aggregate-driven (it grows as topics converge across many repositories).

---

## 3. Enrichment Flow

```
Repository ──► Topic Skill (targeted, local)
                    │
                    ▼
          Semantic similarity check
          against Global Type Skill
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
   High similarity         Low similarity
        │                       │
        ▼                       ▼
  Auto-promote to        Becomes Pseudotype
  Global Type Skill      (Type+Topic local file)
                                │
                                ▼
                  Multiple pseudotypes
                  converging on pattern?
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
                  Yes                       No
                    │                       │
                    ▼                       ▼
            Promote to Type           Stay as
            (novel pattern            Pseudotype
             confirmed)
```

The Global Type Skill, once enriched, **feeds back** into future Topic Skill generation — better Type scaffolding makes new topic enrichment faster and more accurate. This is the system's virtuous cycle.

---

## 4. The Pseudotype Quality Gate

Not every repository's topic signal is high-quality enough to influence the public Type Skill. The **Pseudotype** mechanism solves this:

- A Pseudotype is a **local Type+Topic combined file** — a sandboxed parent that gives a topic full type context without polluting the global Type aggregate.
- Pseudotypes earn their way to the global Type only by **semantic similarity to existing Type content** (auto-promote) or **convergence across multiple pseudotypes on the same novel pattern** (evidence-gated promote).
- This produces two paths into the global Type:
  1. **Confirmation path** — high similarity reinforces existing knowledge.
  2. **Discovery path** — multiple converging pseudotypes confirm a genuinely new pattern is real, not noise.

Without the discovery path, the Type can only deepen what it already knows. Without the confirmation path, the Type is unstable. Both are required.

---

## 5. Storage & Naming Convention

Every skill artifact has a deterministic identifier:

| File | Contents | Identifier length | Example |
|------|----------|-------------------|---------|
| Language Skill file | Language Skill | 5 chars | `5k2v1.md` |
| Pseudotype file (Type+Topic) | Type Skill (general) + Topic Skill (targeted) | 10 chars | `1g53syp407.md` |
| LTT Skill file | Language + Type + Topic, fully assembled | 15 chars | `5k2v11g53syp407.md` |

The 15-character LTT identifier is the concatenation of its 5-char Language code and 10-char Type+Topic code, making the composition transparent and reversible.

**Recommendation:** pair every code with a human-readable slug in the filename for authoring/debugging ergonomics — e.g. `5k2v1-react.md`. The opaque code remains canonical; the slug is courtesy.

---

## 6. The `.ltt` File Format

The final assembled artifact uses a dedicated extension: **`.ltt`** (Language-Type-Topic).

**Why `.ltt` and not `.rad`:** file extensions should describe what's *in* the file, not the system that produced it. `.ltt` tells a cold reader the artifact is a Language-Type-Topic composite. `.rad` would require knowing the broader system first.

**Recommended structure:** YAML frontmatter + markdown body — the same pattern used by OpenAPI, package.json-adjacent tools, and similar widely-adopted formats. This gives:

- Machine-parseable metadata (Language version stamp, Type reference ID, Topic signature, semantic similarity score at generation time, schema version)
- Human-readable narrative body (no special tooling required to inspect)
- A defined upgrade path through the schema version field

**Snapshot semantics:** an LTT file embeds the Type content present at the moment of generation. It does **not** dynamically reference the Global Type. This is intentional — skill files must be predictable; an LTT that silently changes when the Global Type evolves would cause behavior drift in deployed skills with no signal that anything changed.

To make staleness visible rather than invisible, the 10-digit Type+Topic code embeds a Type version stamp. An LTT referencing an outdated Type version is detectable at a glance, and regeneration becomes an explicit, intentional act.

---

## 7. Why This Matters

### For Repository Mapping

Repository mapping today is a flat exercise — read the README, scan structure, infer purpose. RAD turns it into a **structured, comparable artifact**. Because the Global Type Skill is a cross-repo aggregate, repositories can be compared by how their LTT signatures overlap: which repos share a Type, which Topics cluster together, which Languages co-occur. Repositories stop being isolated islands and become entries in a queryable, dimensional space.

The remaining gap is temporal — a snapshot LTT does not capture how a repository's scope has shifted over time. Repos with high evolution velocity may need periodic regeneration with version-aware identifiers.

### For AI Understanding of Technological Concepts

This is where RAD has the most leverage.

AI models currently hold technological knowledge as flat text from training data — they know *about* things, but the relationships between concepts are implicit and fuzzy. RAD externalizes that structure explicitly:

- **Language** tells the model *what*.
- **Type** tells the model *how it's categorized*.
- **Topic** tells the model *what it specifically does*.

The self-organizing nature of the Type skill — where the taxonomy emerges from semantic convergence across real repositories rather than being hand-curated — means it reflects how technology actually clusters in practice, not how someone thought it should cluster in theory. That is a fundamentally better foundation for reasoning about technological scope and versatility than anything derived purely from documentation.

---

## 8. Path to Standardization

Most "let's make this a standard" efforts stall because they declare standardization before adoption exists. The realistic sequence:

1. **Build the tooling first** — a parser, a validator, a registry, a generator.
2. **Drive adoption in a community** — GitHub Actions, npm, package registries, or similar high-traffic ecosystems are good targets.
3. **Demonstrate value at scale** — show that LTT-based discovery, comparison, or AI augmentation outperforms current approaches.
4. **Formalize** — only once there is real-world adoption to point to.

Designing the format **as if** it will become a standard — explicit schema versioning, extensibility hooks, a defined upgrade path — costs almost nothing now and positions the project to make a credible standardization proposal later. Declaring it a standard before adoption exists is where most of these efforts die.

---

## 9. Summary

| Principle | What it gives you |
|-----------|-------------------|
| Three independent dimensions (Language × Type × Topic) | Combinatorial coverage without combinatorial authoring cost |
| Repository-driven enrichment | Knowledge grounded in real code, not documentation guesses |
| Pseudotype quality gate | Public Type stays clean; novel patterns still have a discovery path |
| Semantic-similarity promotion | Confirmation tier; convergence promotion adds the discovery tier |
| Snapshot LTT files with version stamps | Predictable artifacts; staleness is visible, not silent |
| YAML+markdown `.ltt` format | Human-readable, machine-parseable, no special tooling required |
| Standards-ready design from day one | Credible path to formalization once adoption is demonstrated |

The core insight: **technology is naturally compositional**, and a knowledge system that mirrors that composition — rather than flattening it into prose — produces artifacts that are simultaneously easier for humans to author, easier for machines to parse, and easier for AI models to reason over.
