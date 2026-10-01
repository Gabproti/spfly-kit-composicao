export default function Brand({
  compact = false,
  dark = false,
}: {
  compact?: boolean;
  dark?: boolean;
}) {
  return (
    <div
      className={`brand official-brand${compact ? " compact" : ""}${dark ? " dark" : ""}`}
    >
      <img
        src={`${import.meta.env.BASE_URL}spfly-logo.png`}
        alt="SPFLY Logística"
      />
      <small>{compact ? "OPERAÇÃO" : "KITS / OPERAÇÃO"}</small>
    </div>
  );
}
