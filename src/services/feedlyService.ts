import { Badge } from "./badge";
import { OptionsService } from "./optionsService";
import { StorageArea } from "./storageArea";
import { ApiUrlDetails, AuthData, Category, Feed, MarkerCount, MarkerCountsResponse, Profile, StreamsContentResponse, Subscription } from "./types/feedlyTypes";

const baseUrl = IsProduction ? 'https://cloud.feedly.com/v3' : 'https://sandbox7.feedly.com';
const redirectUri = IsProduction ? 'https://olsh.github.io/Feedly-Notifier/' : 'http://localhost';

export class FeedlyService {
  private authData: AuthData;

  private constructor(authData?: AuthData) {
    this.authData = authData ?? {
      accessToken: '',
      refreshToken: '',
      feedlyUserId: ''
    };
  }

  public static async createAsync(): Promise<FeedlyService> {
    const auth = await this.getAuthState();
    if (auth != null) {
      Badge.setActive();
      return new FeedlyService(auth);
    }

    return new FeedlyService();
  }

  public static async getAuthState(): Promise<AuthData | null> {
    const storage = await StorageArea.get();
    const auth = await storage.get(["auth"]);

    return auth
      ? auth.auth as AuthData
      : null;
  }

  public isLoggedIn(): boolean {
    return this.authData.accessToken !== '';
  }

  public async getAccessToken() {
    const state = (new Date()).getTime().toString();
    const scope = 'https://cloud.feedly.com/subscriptions';

    const authUrl = this.getApiUrl("auth/auth", new URLSearchParams({
      response_type: "code",
      client_id: ClientId,
      redirect_uri: redirectUri,
      scope: scope,
      state: state
    }));

    chrome.tabs.create({ url: authUrl }).then(() => {
      chrome.tabs.onUpdated.addListener(async (tabId, information, tab) => {
        if (information.url === undefined) {
          return;
        }

        const code = new URL(information.url).searchParams.get('code');

        if (code) {
          try {
            const response = await this.requestAsync("auth/token", {
              method: "POST",
              skipAuthHeader: true,
              parameters: new URLSearchParams({
                code: code,
                client_id: ClientId,
                client_secret: ClientSecret,
                grant_type: "authorization_code",
                redirect_uri: redirectUri
              })
            });

            this.authData = {
              accessToken: response.access_token,
              refreshToken: response.refresh_token,
              feedlyUserId: response.id
            };

            const storage = await StorageArea.get();
            await storage.set({ auth: this.authData });
            Badge.setActive();
          } catch (error) {
            console.error(error)
          }
        }
      });
    });
  }

  public async logout() {
    const storage = await StorageArea.get();
    await storage.set({ auth: null });

    this.authData = {
      accessToken: '',
      refreshToken: '',
      feedlyUserId: ''
    };

    Badge.setInactive();
    Badge.setText("");
  }

  public async getCountsAsync(parameters: URLSearchParams): Promise<MarkerCountsResponse> {
    const response = await this.requestAsync("markers/counts", {
      method: "GET",
      skipAuthHeader: false,
      parameters: parameters
    }).catch(() => { return { unreadcounts: [], updated: new Date().getTime() }; });

    return response as MarkerCountsResponse;
  }

  public async getSubscriptionsAsync(): Promise<Subscription[]> {
    const response = await this.requestAsync("subscriptions", {
      method: "GET",
      skipAuthHeader: false,
      parameters: new URLSearchParams()
    }).catch(() => { return []; });

    return response as Subscription[];
  }

  public async getCategoriesAndProfileAsync(): Promise<[Category[], Profile]> {

    const categories = await this.getCategoriesAsync();
    const profile = await this.getProfileDataAsync();

    return [categories, profile];
  }

  public async getCachedFeedsAsync(forceUpdate: boolean): Promise<Feed[]> {
    const cachedFeeds = await chrome.storage.local.get("cachedFeeds");

    console.log(`cachedFeeds: ${JSON.stringify(cachedFeeds)}`);
    if (cachedFeeds?.cachedFeeds && !forceUpdate) {
      console.log(`return cachedFeeds: ${JSON.stringify(cachedFeeds.cachedFeeds)}`);
      return cachedFeeds.cachedFeeds as Feed[];
    } else {
      console.log('getting feeds');
      const feeds = await this.getFeedsAsync(true);
      return feeds;
    }
  }

  public async getFeedsAsync(silentUpdate: boolean): Promise<Feed[]> {
    console.log('getFeedsAsync');
    const options = await OptionsService.getOptionsFromStorage();
    chrome.storage.local.remove("cachedFeeds");

    let streamIds = options.isFiltersEnabled && options.filters.length > 0
      ? options.filters
      : [`user/${this.authData.feedlyUserId}/category/global.all`];

    let cachedFeeds: Feed[] = [];

    const subscriptions = await this.getSubscriptionsAsync();
    console.log(`streamIds: ${JSON.stringify(streamIds)}`);

    let subscriptionsMap: { [key: string]: string } = {};
    subscriptions.forEach(item => { subscriptionsMap[item.id] = item.title; });

    for (let i = 0; i < streamIds.length; i++) {
      const response = (await this.requestAsync(`streams/${encodeURIComponent(streamIds[i])}/contents`, {
        method: "GET",
        skipAuthHeader: false,
        parameters: new URLSearchParams({
          unreadOnly: "true",
          count: options.maxNumberOfFeeds.toString(),
          ranked: options.sortBy
        })
      }).catch((error) => {
        console.log(`can't get streams: ${JSON.stringify(error)}`);
        return { items: [] }; })) as StreamsContentResponse;

      for (const item of response.items) {
        let blogUrl;
        try {
          blogUrl = item.origin.htmlUrl.match(/https?:\/\/[^:/?]+/i)?.pop();
        } catch (exception) {
          blogUrl = "#";
        }

        //Set content
        let content;
        let contentDirection;
        if (options.showFullFeedContent) {
          if (item.content !== undefined) {
            content = item.content.content;
            contentDirection = item.content.direction;
          }
        }

        if (!content) {
          if (item.summary !== undefined) {
            content = item.summary.content;
            contentDirection = item.summary.direction;
          }
        }

        let titleDirection;
        let title = item.title;

        //Sometimes Feedly doesn't have title property, so we put content
        // Feedly website do the same trick
        if (!title) {
          if (item.summary && item.summary.content) {
            let contentWithoutTags = item.summary.content.replace(/<\/?[^>]+(>|$)/g, "");
            const maxTitleLength = 100;
            if (contentWithoutTags.length > maxTitleLength) {
              title = contentWithoutTags.substring(0, maxTitleLength) + "...";
            } else {
              title = contentWithoutTags;
            }
          }
        }

        if (!title) {
          title = "[no title]";
        }

        if (title && title.indexOf("direction:rtl") !== -1) {
          //Feedly wraps rtl titles in div, we remove div because desktopNotification supports only text
          title = title.replace(/<\/?div.*?>/gi, "");
          titleDirection = "rtl";
        }

        let isSaved = false;
        if (item.tags) {
          for (let tag of item.tags) {
            if (tag.id.search(/global\.saved$/i) !== -1) {
              isSaved = true;
              break;
            }
          }
        }

        let blog;
        let blogTitleDirection;
        if (item.origin) {
          // Trying to get the user defined name of the stream
          blog = subscriptionsMap[item.origin.streamId] || item.origin.title || "";

          if (blog.indexOf("direction:rtl") !== -1) {
            //Feedly wraps rtl titles in div, we remove div because desktopNotifications support only text
            blog = item.origin.title.replace(/<\/?div.*?>/gi, "");
            blogTitleDirection = "rtl";
          }
        }

        let googleFaviconUrl = "https://www.google.com/s2/favicons?domain=" + blogUrl + "%26sz=64%26alt=feed";

        const feed: Feed = {
          title: title,
          titleDirection: titleDirection,
          url: (item.alternate ? item.alternate[0] ? item.alternate[0].href : "" : "") || blogUrl,
          blog: blog,
          blogTitleDirection: blogTitleDirection,
          blogUrl: blogUrl,
          blogIcon: "https://i.olsh.me/icon?url=" + blogUrl + "&size=16..64..300&fallback_icon_url=" + googleFaviconUrl,
          id: item.id,
          content: content,
          contentDirection: contentDirection,
          isoDate: item.crawled ? new Date(item.crawled).toISOString() : "",
          date: item.crawled ? new Date(item.crawled) : new Date(),
          isSaved: isSaved,
          categories: item.categories,
          author: item.author,
          thumbnail: item.thumbnail && item.thumbnail.length > 0 && item.thumbnail[0].url ? item.thumbnail[0].url : undefined,
          showEngagement: item.engagement > 0,
          engagement: item.engagement > 1000 ? Math.trunc(item.engagement / 1000) : item.engagement,
          engagementPostfix: item.engagement > 1000 ? "K" : "",
          engagementRate: item.engagementRate || 0,
          isEngagementHot: item.engagement >= 5000 && item.engagement < 100000,
          isEngagementOnFire: item.engagement >= 100000
        };

        cachedFeeds.push(feed);
        console.log('added to cachedFeeds');
      }
    }

    // Remove duplicates
    cachedFeeds = cachedFeeds.filter(function (value, index, feeds) {
      for (let i = ++index; i < feeds.length; i++) {
        if (feeds[i].id === value.id) {
          return false;
        }
      }
      return true;
    });

    cachedFeeds = cachedFeeds.sort(function (a, b) {
      if (options.sortBy === "newest") {
        if (a.date > b.date) {
          return -1;
        } else if (a.date < b.date) {
          return 1;
        } else {
          return 0;
        }
      }

      if (options.sortBy === "oldest") {
        if (a.date > b.date) {
          return 1;
        } else if (a.date < b.date) {
          return -1;
        } else {
          return 0;
        }
      }

      if (a.engagementRate < b.engagementRate) {
        return 1;
      } else if (a.engagementRate > b.engagementRate) {
        return -1;
      } else {
        return 0;
      }
    });

    cachedFeeds = cachedFeeds.splice(0, options.maxNumberOfFeeds);

    if (cachedFeeds.length > 0) {
      console.log('storing cachedFeeds');
      chrome.storage.local.set({ cachedFeeds: cachedFeeds });
    } else {
      console.log('cachedFeeds is empty');
    }

    if (!silentUpdate && (options.showDesktopNotifications)) {
      const lastFeedTimeTicks = await chrome.storage.local.get("lastFeedTimeTicks");
      var lastFeedTime;

        if (lastFeedTimeTicks.lastFeedTimeTicks) {
            lastFeedTime = new Date(lastFeedTimeTicks.lastFeedTimeTicks);
        } else {
            lastFeedTime = new Date(1971, 0, 1);
        }

        var newFeeds: Feed[] = [];
        var maxFeedTime = lastFeedTime;

        for (var i = 0; i < cachedFeeds.length; i++) {
            if (cachedFeeds[i].date > lastFeedTime) {
                newFeeds.push(cachedFeeds[i]);
                if (cachedFeeds[i].date > maxFeedTime) {
                    maxFeedTime = cachedFeeds[i].date;
                }
            }
        }

        chrome.storage.local.set({ lastFeedTimeTicks: maxFeedTime.getTime()});
        //TODO: send notifications
        //sendDesktopNotification(newFeeds);
    }

    return cachedFeeds;
  }

  private async getCategoriesAsync(): Promise<Category[]> {
    try {
      const data = await this.requestAsync("categories", {
        method: "GET",
        skipAuthHeader: false,
        parameters: new URLSearchParams()
      });

      const categories = data as Category[];
      categories.push({
        id: "user/" + this.authData.feedlyUserId + "/category/global.must",
        label: "Global Favorites"
      });
      categories.push({
        id: "user/" + this.authData.feedlyUserId + "/category/global.uncategorized",
        label: "Global Uncategorized"
      });

      return categories;
    } catch (error) {
      return [];
    }
  }

  private async getProfileDataAsync(): Promise<Profile> {
    try {
      const data = await this.requestAsync("profile", {
        method: "GET",
        skipAuthHeader: false,
        parameters: new URLSearchParams()
      });

      const profile: Profile = {
        name: `${data.givenName} ${data.familyName}`,
        email: data.email
      }

      return profile;
    } catch (error) {
      return { name: "-", email: "-" };
    }
  }

  private getApiUrl(apiMethod: string, parameters: URLSearchParams) {
    if (apiMethod === undefined) {
      return "";
    }

    const extensionVersion = chrome.runtime.getManifest().version;

    return `${baseUrl}/${apiMethod}?${parameters.toString()}&av=${Browser[0]}${extensionVersion}`;
  };

  private async requestAsync(apiMethod: string, details: ApiUrlDetails): Promise<any> {
    let url = this.getApiUrl(apiMethod, details.parameters);

    if (!details.skipAuthHeader && this.authData?.accessToken == '') {
      Badge.setInactive();
      return Promise.reject(new Error('No access token found.'));
    }

    // For bypassing the cache
    if (details.method === "GET") {
      url += ((/\?/).test(url) ? "&" : "?") + "ck=" + (new Date()).getTime();
    }

    let headers: HeadersInit = {};

    if (this.authData && this.authData?.accessToken && !details.skipAuthHeader) {
      headers['Authorization'] = `OAuth ${this.authData.accessToken}`;
    }

    let requestParameters: RequestInit = {
      method: details.method,
      headers: headers
    };

    if (details.body) {
      requestParameters.body = JSON.stringify(details.body);
    }

    try {
      var response = await fetch(url, requestParameters);

      if (response.status === 401 && !details.skipAuthHeader) {
        await this.refreshTokenAsync();
        headers['Authorization'] = `OAuth ${this.authData.accessToken}`;
        requestParameters.headers = headers;
        response = await fetch(url, requestParameters);
      }

      if (response.ok) {
        return await response.json();
      } else {
        return Promise.reject(new Error(`Failed to fetch data from ${url}: ${response.status} ${response.statusText}`));
      };
    } catch (error) {
      console.error(error);
      return Promise.reject(error);
    }
  }

  private async refreshTokenAsync() {
    if (this.authData.refreshToken == '') {
      Badge.setInactive();
      return;
    }

    try {
      const response = await this.requestAsync("auth/token", {
        method: "POST",
        skipAuthHeader: true,
        parameters: new URLSearchParams({
          refresh_token: this.authData.refreshToken,
          client_id: ClientId,
          client_secret: ClientSecret,
          grant_type: "refresh_token"
        })
      });

      this.authData.accessToken = response.access_token;
      this.authData.feedlyUserId = response.id;

      const storage = await StorageArea.get();
      await storage.set({ auth: this.authData });
      Badge.setActive();
    } catch (error) {
      Badge.setInactive();
      throw new Error("Failed to refresh access token: " + error);
    }
  }
}
