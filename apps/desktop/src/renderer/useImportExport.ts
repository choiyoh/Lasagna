import { useCallback } from 'react';
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
        if (r.saved) setToast({ message: `내보냈어요: ${r.saved}` });
      } catch (e) {
        setToast({ message: `내보내기 실패: ${e instanceof Error ? e.message : String(e)}` });
      }
    },
    [selected, setToast],
  );
  const exportVault = useCallback(async () => {
    try {
      await flushAll();
      const r = await window.nops.export.vault();
      if (r.dir) setToast({ message: `노트 ${r.notes}개·첨부 ${r.assets}개를 내보냈어요: ${r.dir}` });
    } catch (e) {
      setToast({ message: `내보내기 실패: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [setToast]);

  const importNotion = useCallback(async () => {
    try {
      const r = await window.nops.import.notion();
      if (!r.folder) return;
      refresh();
      setToast({
        message: `Notion에서 노트 ${r.notes}개·데이터베이스 ${r.databases}개·첨부 ${r.assets}개를 "${r.folder}" 폴더로 가져왔어요${r.unresolvedLinks ? ` (연결 못 한 링크 ${r.unresolvedLinks}개)` : ''}.`,
      });
    } catch (e) {
      setToast({ message: `가져오기 실패: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [refresh, setToast]);

  return { exportNote, exportVault, importNotion };
}
