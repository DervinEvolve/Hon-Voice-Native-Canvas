import { useEffect } from 'react';
import { mediaCache } from '../utils/mediaCache';
import { Comic } from '../types';

export const usePagePreloader = (
  comic: Comic | null,
  currentPageIndex: number
) => {
  useEffect(() => {
    if (!comic || !comic.pages) return;

    const preloadPages = async () => {
      // Preload next page
      const nextPageIndex = currentPageIndex + 1;
      if (nextPageIndex < comic.pages.length) {
        const nextPage = comic.pages[nextPageIndex];
        if (nextPage) {
          nextPage.forEach(media => {
            if (media.url) {
              mediaCache.preload(media.url).catch(console.error);
            }
          });
        }
      }

      // Preload previous page
      const prevPageIndex = currentPageIndex - 1;
      if (prevPageIndex >= 0) {
        const prevPage = comic.pages[prevPageIndex];
        if (prevPage) {
          prevPage.forEach(media => {
            if (media.url) {
              mediaCache.preload(media.url).catch(console.error);
            }
          });
        }
      }
    };

    preloadPages();
  }, [comic, currentPageIndex]);
}; 