import { useMemo } from "react";
import { Download, Printer, QrCode } from "lucide-react";
import { Link } from "react-router";
import { Button, Card, PageHeader } from "../components/ops-ui";

function portalUrl() {
  if (typeof window === "undefined") return "/employee-portal";
  return `${window.location.origin}/employee-portal`;
}

export function EmployeePortalQrPage() {
  const targetUrl = useMemo(() => portalUrl(), []);
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=720x720&margin=20&data=${encodeURIComponent(targetUrl)}`;

  return (
    <div className="ops-page ops-self-service">
      <PageHeader
        title="Employee Recognition Display QR"
        subtitle="Use this QR code to open the public-area display that waits for face recognition events."
        actions={
          <>
            <Button tone="secondary" onClick={() => window.print()}>
              <Printer size={15} />
              Print
            </Button>
            <a className="ops-button ops-button-primary" href={qrImageUrl} download="employee-portal-qr.png">
              <Download size={15} />
              Download QR
            </a>
            <Link className="ops-button ops-button-secondary" to="/employee-portal">
              Open Display
            </Link>
          </>
        }
      />

      <Card>
        <div className="ops-portal-qr-layout">
          <div className="ops-portal-qr-frame">
            <img src={qrImageUrl} alt={`QR code for ${targetUrl}`} className="ops-portal-qr-image" />
          </div>
          <div className="ops-portal-qr-copy">
            <div className="ops-brand-mark-small">
              <QrCode size={24} />
            </div>
            <h2>LineMatrix Recognition Display</h2>
            <p>Open the public display and keep it ready for the ANPR face recognition camera.</p>
            <div className="ops-portal-url">{targetUrl}</div>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default EmployeePortalQrPage;
