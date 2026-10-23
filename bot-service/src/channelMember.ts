export function isInsideChannel(status: string | undefined, isMember?: boolean): boolean {
  if (status === "creator" || status === "administrator" || status === "member") return true;
  if (status === "restricted") return isMember === true;
  return false;
}
