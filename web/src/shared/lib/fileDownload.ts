/**
 * A file the page makes itself, offered to the browser as a link with `download` is: the browser
 * saves it under `name`, or asks where, as it does for any download.
 */
export function offerDownload(name: string, text: string, type: string): void {
  const address = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = address
  link.download = name
  link.click()
  // The browser has read the file by the next turn of the loop; the address is let go then.
  setTimeout(() => URL.revokeObjectURL(address), 0)
}
