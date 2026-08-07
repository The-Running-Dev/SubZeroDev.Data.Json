/** `20-contract.md` §9. The producer for `unwrap: 'subzerodev'` (D28); J2.5's round-trip test keeps the two ends agreeing. */
export function envelope<T>(data: T): { readonly success: true; readonly data: T } {
  return { success: true, data };
}
