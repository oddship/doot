/** Show a human sender name while retaining the original header as the tooltip. */
export function senderDisplayName(sender: string) {
  const value = sender.trim();
  const address = value.match(/^(.*?)\s*<([^<>]+)>$/);
  if (!address) return value;
  return address[1].trim().replace(/^"(.*)"$/, "$1") || address[2].trim();
}
