import { openDB } from 'idb'
import type { IDBPDatabase } from 'idb'

const DB_NAME = 'meshplanner-dem-cache'
const DB_VERSION = 2
const STORE_NAME = 'tiles'

let dbPromise: Promise<IDBPDatabase> | null = null

async function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore(STORE_NAME)
        }
        // Version 2 stores structured objects instead of JSON strings —
        // the old string store is dropped automatically since we use the
        // same store name; stale string entries will fail the shape check
        // in the caller and be replaced on next fetch.
      },
    })
  }
  return dbPromise
}

export interface CachedTile {
  data: Float32Array
  width: number
  height: number
}

export async function getFromCache(key: string): Promise<CachedTile | undefined> {
  try {
    const db = await getDb()
    const raw = await db.get(STORE_NAME, key)
    // Version-compat: old stores used JSON strings — reject them.
    if (!raw || typeof raw === 'string' || !(raw.data instanceof Float32Array)) return undefined
    return raw as CachedTile
  } catch {
    return undefined
  }
}

export async function storeInCache(key: string, value: CachedTile): Promise<void> {
  try {
    const db = await getDb()
    await db.put(STORE_NAME, value, key)
  } catch {
    /* silently fail — cache miss degrades gracefully */
  }
}

export async function clearCache(): Promise<void> {
  const db = await getDb()
  await db.clear(STORE_NAME)
}
