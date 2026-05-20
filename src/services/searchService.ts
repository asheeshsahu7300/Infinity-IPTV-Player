import { Channel, VODItem, Series } from "../store/portalStore";

// ============================================================================
// SEARCH SERVICE (Client-Side with Fuzzy Matching)
// ============================================================================

interface SearchIndex {
  channels: Channel[];
  vod: VODItem[];
  series: Series[];
  lastUpdated: number;
}

class SearchService {
  private index: SearchIndex = {
    channels: [],
    vod: [],
    series: [],
    lastUpdated: 0,
  };

  /**
   * Build search index from current data
   */
  buildIndex(
    channels: Channel[],
    vod: VODItem[],
    series: Series[]
  ): void {
    this.index = {
      channels,
      vod,
      series,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Universal search across all content types
   */
  search(query: string, type?: "channels" | "vod" | "series"): {
    channels: Channel[];
    vod: VODItem[];
    series: Series[];
  } {
    if (!query || query.length < 2) {
      return { channels: [], vod: [], series: [] };
    }

    const lowerQuery = query.toLowerCase();

    const results = {
      channels: type === "channels" || !type 
        ? this.searchChannels(lowerQuery) 
        : [],
      vod: type === "vod" || !type 
        ? this.searchVOD(lowerQuery) 
        : [],
      series: type === "series" || !type 
        ? this.searchSeries(lowerQuery) 
        : [],
    };

    return results;
  }

  /**
   * Search channels
   */
  private searchChannels(query: string): Channel[] {
    return this.index.channels
      .filter((channel) => {
        return (
          channel.name?.toLowerCase().includes(query) ||
          channel.category?.toLowerCase().includes(query)
        );
      })
      .slice(0, 50); // Limit results
  }

  /**
   * Search VOD items
   */
  private searchVOD(query: string): VODItem[] {
    return this.index.vod
      .filter((item) => {
        return (
          item.name?.toLowerCase().includes(query) ||
          item.description?.toLowerCase().includes(query) ||
          item.year?.includes(query)
        );
      })
      .slice(0, 50); // Limit results
  }

  /**
   * Search series
   */
  private searchSeries(query: string): Series[] {
    return this.index.series
      .filter((item) => {
        return (
          item.name?.toLowerCase().includes(query) ||
          item.description?.toLowerCase().includes(query) ||
          item.year?.includes(query)
        );
      })
      .slice(0, 50); // Limit results
  }

  /**
   * Get recent searches
   */
  private recentSearches: string[] = [];
  private maxRecentSearches = 10;

  addRecentSearch(query: string): void {
    if (!query || query.length < 2) return;

    // Remove if already exists
    this.recentSearches = this.recentSearches.filter((q) => q !== query);

    // Add to beginning
    this.recentSearches.unshift(query);

    // Keep only max recent searches
    if (this.recentSearches.length > this.maxRecentSearches) {
      this.recentSearches = this.recentSearches.slice(
        0,
        this.maxRecentSearches
      );
    }
  }

  getRecentSearches(): string[] {
    return this.recentSearches;
  }

  clearRecentSearches(): void {
    this.recentSearches = [];
  }

  /**
   * Suggestions based on query
   */
  getSuggestions(query: string, limit: number = 5): string[] {
    if (!query || query.length < 2) return [];

    const lowerQuery = query.toLowerCase();
    const suggestions = new Set<string>();

    // Add matching channel names
    this.index.channels.forEach((channel) => {
      if (
        channel.name?.toLowerCase().startsWith(lowerQuery) &&
        suggestions.size < limit
      ) {
        suggestions.add(channel.name);
      }
    });

    // Add matching VOD names
    this.index.vod.forEach((item) => {
      if (
        item.name?.toLowerCase().startsWith(lowerQuery) &&
        suggestions.size < limit
      ) {
        suggestions.add(item.name);
      }
    });

    // Add matching series names
    this.index.series.forEach((item) => {
      if (
        item.name?.toLowerCase().startsWith(lowerQuery) &&
        suggestions.size < limit
      ) {
        suggestions.add(item.name);
      }
    });

    return Array.from(suggestions);
  }

  /**
   * Highlight matching text in results
   */
  highlightMatch(text: string, query: string): { text: string; isMatch: boolean }[] {
    if (!query || !text) return [{ text, isMatch: false }];

    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);

    if (index === -1) {
      return [{ text, isMatch: false }];
    }

    return [
      { text: text.slice(0, index), isMatch: false },
      { text: text.slice(index, index + query.length), isMatch: true },
      { text: text.slice(index + query.length), isMatch: false },
    ].filter((part) => part.text.length > 0);
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      channels: this.index.channels.length,
      vod: this.index.vod.length,
      series: this.index.series.length,
      lastUpdated: this.index.lastUpdated,
    };
  }

  /**
   * Clear index
   */
  clear(): void {
    this.index = {
      channels: [],
      vod: [],
      series: [],
      lastUpdated: 0,
    };
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const searchService = new SearchService();
