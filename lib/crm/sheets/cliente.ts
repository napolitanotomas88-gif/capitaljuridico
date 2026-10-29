import { google, type sheets_v4 } from "googleapis";
import { credencialesGoogle } from "@/lib/crm/config";

let cliente: sheets_v4.Sheets | null = null;

/** Cliente de Google Sheets autenticado con la cuenta de servicio. Solo servidor. */
export function sheets(): sheets_v4.Sheets {
  if (!cliente) {
    const { email, privateKey } = credencialesGoogle();
    const auth = new google.auth.JWT({
      email,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    cliente = google.sheets({ version: "v4", auth });
  }
  return cliente;
}
