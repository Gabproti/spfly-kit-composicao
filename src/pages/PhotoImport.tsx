import { useCallback, useState } from "react";
import PhotoImport from "../components/PhotoImport";
export default function PhotoImportPage({
  onBusy,
  onBack,
}: {
  onBusy: (busy: boolean) => void;
  onBack: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const reportBusy = useCallback(
    (value: boolean) => {
      setBusy(value);
      onBusy(value);
    },
    [onBusy],
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PRODUTOS</span>
          <h1>Importar imagens</h1>
          <p>Analise a correspondência antes de enviar as fotos.</p>
        </div>
        <button className="secondary" disabled={busy} onClick={onBack}>
          Voltar para Produtos
        </button>
      </div>
      <PhotoImport onBusy={reportBusy} />
    </>
  );
}
