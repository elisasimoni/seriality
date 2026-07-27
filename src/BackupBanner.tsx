import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BACKUP_EVERY_DAYS, backupDue, downloadLocalBackup, lastLocalBackup, snoozeBackup } from './db';
import { toast } from './components';

/**
 * Promemoria del backup locale: compare quando l'ultima copia scaricata ha più
 * di BACKUP_EVERY_DAYS giorni. Il sync cloud è automatico, questa è la seconda
 * gamba — un file sul telefono che sopravvive anche a Supabase.
 *
 * useLiveQuery e non useEffect: così sparisce da solo appena scarichi il backup
 * dalle Impostazioni, senza aspettare un ricaricamento della pagina.
 */
export default function BackupBanner() {
  const due = useLiveQuery(backupDue, [], false);
  const last = useLiveQuery(lastLocalBackup, []);
  const [busy, setBusy] = useState(false);

  if (!due) return null;

  const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400_000) : null;

  return (
    <div className="backup-banner">
      <span className="bb-ico">💾</span>
      <div className="bb-txt">
        <b>{days === null ? 'Non hai ancora scaricato un backup' : `Ultimo backup scaricato ${days} giorni fa`}</b>
        <span>Una copia sul telefono ti salva anche se il cloud non è raggiungibile. Te lo ricordo ogni {BACKUP_EVERY_DAYS} giorni.</span>
      </div>
      <button
        className="btn primary" disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await downloadLocalBackup();
            toast('Backup scaricato 💾');
          } finally {
            setBusy(false);
          }
        }}
      >⬇️ Scarica</button>
      <button
        className="btn"
        onClick={async () => { await snoozeBackup(); toast('Te lo ricordo domani'); }}
      >Più tardi</button>
    </div>
  );
}
