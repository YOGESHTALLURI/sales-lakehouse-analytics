import { useEffect } from 'react';

const SUFFIX = 'Sales Lakehouse Analytics';

/** Route changes are announced to assistive technology through the title. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · ${SUFFIX}`;
  }, [title]);
}
