import { useCallback } from 'react';
import { t, tPlural } from '@nopsidian/i18n';
import type { Dispatch, SetStateAction } from 'react';
import type { Toast } from './app-types';
import { flushAll } from './flush';
import { userMessage } from './user-message';

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
        setToast({ message: t('import.exportFailed', { message: userMessage(e) }) });
      }
    },
    [selected, setToast],
  );
  const exportVault = useCallback(async () => {
    try {
      await flushAll();
      const r = await window.nops.export.vault();
      if (r.dir) {
        setToast({
          message: t('import.exportedVault', {
            notes: tPlural('count.notes', r.notes),
            assets: tPlural('count.assets', r.assets),
            dir: r.dir,
          }),
        });
      }
    } catch (e) {
      setToast({ message: t('import.exportFailed', { message: userMessage(e) }) });
    }
  }, [setToast]);

  const importNotion = useCallback(async () => {
    try {
      const r = await window.nops.import.notion();
      if (!r.folder) return;
      refresh();
      setToast({
        message: t(r.unresolvedLinks ? 'import.notionDoneUnresolved' : 'import.notionDone', {
          notes: tPlural('count.notes', r.notes),
          databases: tPlural('count.databases', r.databases),
          assets: tPlural('count.assets', r.assets),
          folder: r.folder,
          links: tPlural('count.unlinkedLinks', r.unresolvedLinks),
        }),
      });
    } catch (e) {
      setToast({ message: t('import.failed', { message: userMessage(e) }) });
    }
  }, [refresh, setToast]);

  const importMarkdown = useCallback(
    async (mode: 'files' | 'folder' | 'paths', paths?: string[], into?: string) => {
      try {
        const r = await window.nops.import.markdown({ mode, paths, into });
        if (r.imported.length === 0 && r.skipped.length === 0) return;
        refresh();
        const parts = [
          r.assets
            ? t('import.doneNotesAssets', { notes: tPlural('count.notes', r.notes), assets: tPlural('count.assets', r.assets) })
            : t(r.notes === 1 ? 'import.doneNotes.one' : 'import.doneNotes.other', { notes: r.notes }),
        ];
        if (r.renamed) parts.push(t(r.renamed === 1 ? 'import.renamed.one' : 'import.renamed.other', { count: r.renamed }));
        if (r.skipped.length) {
          parts.push(t('import.skipped', { count: r.skipped.length, names: `${r.skipped.slice(0, 2).join(', ')}${r.skipped.length > 2 ? ' …' : ''}` }));
        }
        setToast({ message: `${parts.join(' · ')}.` });
      } catch (e) {
        setToast({ message: t('import.failed', { message: userMessage(e) }) });
      }
    },
    [refresh, setToast],
  );

  return { exportNote, exportVault, importNotion, importMarkdown };
}
