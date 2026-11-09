/**
 * Sending one pasted picture to the item it was pasted on. The body is the file's bytes as
 * they are; the server reads what they are from them, checks the size again and answers
 * with the address the text should name.
 */
import { parseContract, strictObject, z } from '@/shared/api/contract.ts'
import { readJsonResponse } from '@/shared/api/readJsonResponse.ts'

const keptSchema = strictObject({
  work_item_id: z.string().min(1).max(64),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  media_type: z.enum(['image/gif', 'image/jpeg', 'image/png', 'image/webp']),
  size: z.number().int().positive(),
  path: z.string().regex(/^\/api\/images\/[0-9a-f]{64}$/u),
})

export type KeptImage = z.infer<typeof keptSchema>

/** Why the server would not keep a picture: its own word for it, where it said one. */
export class ImageRefusal extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`picture refused: ${code}`)
  }
}

const refusalSchema = z.object({ error: z.object({ code: z.string().max(80) }) })

function invalid(path: string, detail: string): never {
  throw new Error(`${path}: ${detail}`)
}

export async function uploadImage(
  workItemId: string,
  file: Blob,
  signal?: AbortSignal,
): Promise<KeptImage> {
  const { response, payload } = await readJsonResponse(
    `/api/images?item=${encodeURIComponent(workItemId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
      signal,
    },
  )
  if (!response.ok) {
    const refused = refusalSchema.safeParse(payload)
    throw new ImageRefusal(refused.success ? refused.data.error.code : '', response.status)
  }
  return parseContract(keptSchema, payload, 'images.upload', invalid)
}
