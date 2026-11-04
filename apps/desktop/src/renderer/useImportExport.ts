import { useCallback } from 'react';
import { t } from '@nopsidian/i18n';
import type { Dispatch, SetStateAction } from 'react';
import type { Toast } from './app-types';
import { flushAll } from './flush';

/** 노트·볼트 내보내기와 Notion 가져오기(결과는 알림으로 알린다) */
export function useImportExport({ selected, refresh, setToast }: { selected: string | null; refresh: () => void; setToast: Dispatch<SetStateAction<Toast | null>> }) {
  const exportNote = useCallback(
    async (format: 'html' | 'pdf') => {
      if (!selected) return;
      try {
        await flushAll();
        const r = await window.nops.export.note({ path: selected, format });
        if (r.saved) setToast({ message: t('import.exported', { path: r.saved }) });
      } catch (e) {
        setToast({ message: t('import.exportFailed', { message: e instanceof Error ? e.message : String(e) }) });
      }
    },
    [selected, setToast],
  );
  const exportVault = useCallback(async () => {
    try {
      await flushAll();
      const r = await window.nops.export.vault();
      if (r.dir) setToast({ message: t('import.exportedVault', { notes: r.notes, assets: r.assets, dir: r.dir }) });
    } catch (e) {
      setToast({ message: t('import.exportFailed', { message: e instanceof Error ? e.message : String(e) }) });
    }
  }, [setToast]);

  const importNotion = useCallback(async () => {
    try {
      const r = await window.nops.import.notion();
      if (!r.folder) return;
      refresh();
      setToast({
        message: t(r.unresolvedLinks ? 'import.notionDoneUnresolved' : 'import.notionDone', {
          notes: r.notes,
          databases: r.databases,
          assets: r.assets,
          folder: r.folder,
          links: r.unresolvedLinks,
        }),
      });
    } catch (e) {
      setToast({ message: t('import.failed', { message: e instanceof Error ? e.message : String(e) }) });
    }
  }, [refresh, setToast]);

  const importMarkdown = useCallback(
    async (mode: 'files' | 'folder' | 'paths', paths?: string[], into?: string) => {
      try {
        const r = await window.nops.import.markdown({ mode, paths, into });
        if (r.imported.length === 0 && r.skipped.length === 0) return;
        refresh();
        const parts = [r.assets ? t('import.doneNotesAssets', { notes: r.notes, assets: r.assets }) : t('import.doneNotes', { notes: r.notes })];
        if (r.renamed) parts.push(t('import.renamed', { count: r.renamed }));
        if (r.skipped.length) {
          parts.push(t('import.skipped', { count: r.skipped.length, names: `${r.skipped.slice(0, 2).join(', ')}${r.skipped.length > 2 ? ' …' : ''}` }));
        }
        setToast({ message: `${parts.join(' · ')}.` });
      } catch (e) {
        setToast({ message: t('import.failed', { message: e instanceof Error ? e.message : String(e) }) });
      }
    },
    [refresh, setToast],
  );

  return { exportNote, exportVault, importNotion, importMarkdown };
}
