import { openDB } from 'idb'
import type { IDBPDatabase } from 'idb'

const DB_NAME = 'meshplanner-dem-cache'
const DB_VERSION = 1
const STORE_NAME = 'tiles'

let dbPromise: Promise<IDBPDatabase> | null = null

async function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      },
    })
  }
  return dbPromise
}

export async function getFromCache(key: string): Promise<string | undefined> {
  try {
    const db = await getDb()
    return await db.get(STORE_NAME, key)
  } catch {
    return undefined
  }
}

export async function storeInCache(key: string, value: string): Promise<void> {
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
