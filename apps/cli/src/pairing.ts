// `t3 pair` prints the outbound interface address, which the host browser
// cannot reach. The only part worth keeping is the token; the URL is rebuilt
// against the published loopback port.
const PAIRING_URL = /http:\/\/[^\s"']*#token=[A-Za-z0-9]+/u;

/** The first pairing URL in `text`, or `undefined` when there is none. */
export const parsePairingUrl = (text: string): string | undefined => PAIRING_URL.exec(text)?.[0];

/** Rewrite a pairing URL to the host's published loopback port. */
export const rewritePairingUrl = (raw: string, hostPort: number): string | undefined => {
  const token = raw.split("#token=")[1];
  if (token === undefined || token.length === 0) return undefined;
  return `http://localhost:${hostPort}/pair#token=${token}`;
};
