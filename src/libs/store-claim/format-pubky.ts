export function groupPubky(pubky: string): string {
  return pubky.match(/.{1,4}/g)?.join(' ') ?? pubky;
}
