import { requireRole } from "../../../lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";

export default async function SettingsPage() {
  await requireRole(["hq_admin"]);

  return (
    <main className="flex flex-col gap-md p-md">
      <h1 className="text-headline-lg font-headline-lg font-semibold text-on-surface">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Fiscalisation
            <Badge variant="warning">Not yet available</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-body-md font-body-md text-on-surface-variant">
            ZRA Smart Invoice / VSDC fiscal record generation lives in the companion <strong>002-fiscalisation</strong>{" "}
            spec and has not landed yet. Per Constitution v1.1.0 Principle V, a sales feature that cannot produce a
            compliant fiscal record must not be shipped to a live store — <strong>pilot go-live is blocked on
            002-fiscalisation landing</strong>, independent of this MVP&apos;s own feature completeness.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
