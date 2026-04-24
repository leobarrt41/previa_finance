import fs from 'node:fs/promises'
import path from 'node:path'

const DATA_DIR = path.join(process.cwd(), '.data')
const OWNERS_FILE = path.join(DATA_DIR, 'clerk-owners.json')

export interface StoredOwner {
  id: number
  clerkUserId: string
  createdAt: string
  updatedAt: string
}

async function ensureStorageFile() {
  await fs.mkdir(DATA_DIR, { recursive: true })
  try {
    await fs.access(OWNERS_FILE)
  } catch {
    await fs.writeFile(OWNERS_FILE, '[]', 'utf8')
  }
}

async function readOwners(): Promise<StoredOwner[]> {
  await ensureStorageFile()
  const raw = await fs.readFile(OWNERS_FILE, 'utf8')
  if (!raw.trim()) {
    return []
  }

  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    throw new Error('Invalid owner store format')
  }

  return parsed as StoredOwner[]
}

async function writeOwners(owners: StoredOwner[]) {
  await ensureStorageFile()
  const tempFile = `${OWNERS_FILE}.tmp`
  await fs.writeFile(tempFile, `${JSON.stringify(owners, null, 2)}\n`, 'utf8')
  await fs.rename(tempFile, OWNERS_FILE)
}

export async function resolveOwnerId(clerkUserId: string): Promise<StoredOwner> {
  const owners = await readOwners()
  const existing = owners.find((owner) => owner.clerkUserId === clerkUserId)
  if (existing) {
    return existing
  }

  const now = new Date().toISOString()
  const nextId = owners.reduce((max, owner) => Math.max(max, owner.id), 0) + 1
  const owner: StoredOwner = {
    id: nextId,
    clerkUserId,
    createdAt: now,
    updatedAt: now,
  }

  owners.push(owner)
  await writeOwners(owners)
  return owner
}

export async function findOwnerByClerkUserId(clerkUserId: string): Promise<StoredOwner | undefined> {
  const owners = await readOwners()
  return owners.find((owner) => owner.clerkUserId === clerkUserId)
}
