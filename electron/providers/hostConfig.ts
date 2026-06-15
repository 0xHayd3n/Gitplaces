// electron/providers/hostConfig.ts
//
// Persistent list of host instances. Backed by an injected key-value store so
// the same module is unit-testable (Map backend) and production-runnable
// (electron-store backend, wired up in main.ts).
//
// Storage key: 'hosts.list' — JSON array of HostInstance.

import {
  HOST_ID_GITHUB,
  computeHostId,
  type HostInstance,
  type HostType,
} from './types'

const KEY = 'hosts.list'

export interface HostConfigBackend {
  get(key: string): unknown
  set(key: string, value: unknown): void
  has(key: string): boolean
}

let backend: HostConfigBackend | null = null

export function setHostConfigBackend(b: HostConfigBackend): void {
  backend = b
}

function requireBackend(): HostConfigBackend {
  if (!backend) throw new Error('hostConfig backend not initialized')
  return backend
}

function readAll(): HostInstance[] {
  const raw = requireBackend().get(KEY)
  return Array.isArray(raw) ? (raw as HostInstance[]) : []
}

function writeAll(list: HostInstance[]): void {
  requireBackend().set(KEY, list)
}

export function listHosts(): HostInstance[] {
  return readAll()
}

export function getHost(id: string): HostInstance | null {
  return readAll().find(h => h.id === id) ?? null
}

export function addHost(spec: {
  type: HostType
  baseUrl: string
  label: string
  webUrl?: string
}): HostInstance {
  const id = computeHostId(spec.type, spec.baseUrl)
  const list = readAll()
  if (list.some(h => h.id === id)) {
    throw new Error(`Host ${id} already exists`)
  }
  const inst: HostInstance = {
    id,
    type: spec.type,
    baseUrl: spec.baseUrl,
    label: spec.label,
    addedAt: new Date().toISOString(),
    webUrl: spec.webUrl,
  }
  writeAll([...list, inst])
  return inst
}

export function removeHost(id: string): void {
  writeAll(readAll().filter(h => h.id !== id))
}

const DEFAULT_HOSTS: ReadonlyArray<Omit<HostInstance, 'addedAt'>> = [
  { id: HOST_ID_GITHUB, type: 'github', baseUrl: 'https://api.github.com', label: 'GitHub' },
  { id: 'gl:gitlab.com', type: 'gitlab', baseUrl: 'https://gitlab.com', label: 'GitLab.com' },
  { id: 'gt:codeberg.org', type: 'gitea', baseUrl: 'https://codeberg.org', label: 'Codeberg' },
]

export function seedDefaultHosts(): void {
  const list = readAll()
  const additions: HostInstance[] = []
  const now = new Date().toISOString()
  for (const def of DEFAULT_HOSTS) {
    if (list.some(h => h.id === def.id)) continue
    additions.push({ ...def, addedAt: now })
  }
  if (additions.length > 0) writeAll([...list, ...additions])
}
