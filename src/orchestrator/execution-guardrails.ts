const UNRESOLVED_SUCCESS_SIGNALS: Array<{ label: string; pattern: RegExp }> = [
  { label: "policy-denied", pattern: /denied by policy|execution (?:was )?denied|정책에 의해 거부|권한이 거부/iu },
  { label: "execution-incomplete", pattern: /did not complete|was not completed|unable to complete|could not complete|not executed|완료하지 못|실행되지 않/iu },
  { label: "verification-incomplete", pattern: /could not verify|unable to verify|not verified|unverified|검증할 수 없|검증되지 않|확인할 수 없/iu },
  { label: "placeholder-result", pattern: /still relies on placeholder|still depends on placeholder|placeholder\/no-data fallback|no-data fallback|returns placeholder|플레이스홀더|데이터 없음/iu },
  { label: "missing-data-source", pattern: /missing data source|upstream source is missing|unsupported upstream|원본 데이터가 없|지원되지 않/iu },
  { label: "not-implemented", pattern: /not implemented|currently exposes no .* command|미구현|구현되어 있지 않/iu }
];

export function findUnresolvedSuccessSignal(texts: Iterable<string | null | undefined>): string | null {
  const combined = [...texts]
    .filter((text): text is string => typeof text === "string")
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .join("\n");

  if (combined.length === 0) {
    return null;
  }

  for (const signal of UNRESOLVED_SUCCESS_SIGNALS) {
    if (signal.pattern.test(combined)) {
      return signal.label;
    }
  }

  return null;
}
