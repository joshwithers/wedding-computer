/**
 * Git blob SHA computation — lets push code skip writes when the
 * content already in GitHub is identical (file_index.etag stores the
 * blob sha for git-backed vendors).
 *
 * Git computes a blob's object id as:
 *   sha1("blob " + <byte length> + "\0" + <content>)
 *
 * For R2-backed vendors etags use a different scheme (md5), so the
 * comparison simply never matches and writes proceed as before.
 */

const encoder = new TextEncoder()

export async function gitBlobSha(content: string): Promise<string> {
  const body = encoder.encode(content)
  const header = encoder.encode(`blob ${body.byteLength}\0`)

  const data = new Uint8Array(header.byteLength + body.byteLength)
  data.set(header, 0)
  data.set(body, header.byteLength)

  const digest = await crypto.subtle.digest('SHA-1', data)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
