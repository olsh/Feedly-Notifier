import { AppOptions, defaultOptions } from "../options/appOptions";
import { StorageArea } from "./storageArea";

export class OptionsService {
    private options!: AppOptions;

    private constructor() {}

    public static async createAsync(): Promise<OptionsService> {
        const service = new OptionsService();
        service.options = await OptionsService.getOptionsFromStorage()
        return service;
    }

    public static getDefaultOptions(): AppOptions {
        return defaultOptions;
    }

    public getOptions(): AppOptions {
        return this.options;
    }

    public async setOptions(options: AppOptions, callback?: () => void) {
        const useSync = options.disableOptionsSync ? false : true;
        chrome.storage.local.set({ useSync });

        if (Browser === 'chrome')
            this.setBackgroundMode(options.enableBackgroundMode);

        await this.setAllSitesPermission(options.showBlogIconInNotifications ||
            options.showThumbnailInNotifications, options);

        const storage = await StorageArea.get();
        storage.set({ options }, () => {
            this.options = options;
            if (typeof callback === "function") {
                callback();
            }
          });
    }

    public async clearStorage() {
        (await StorageArea.get()).clear();
    }

    public static async getOptionsFromStorage() : Promise<AppOptions> {
        const storage = await StorageArea.get();
        const options = await storage.get(null);

        if (options.options) {
            return options.options as AppOptions;
        } else {
            return defaultOptions;
        }
    }

    private setBackgroundMode (enable: boolean) {
        if (enable) {
          chrome.permissions.request({ permissions: ["background"] });
        } else {
          chrome.permissions.remove({ permissions: ["background"] });
        }
    }

    private async setAllSitesPermission(enable: boolean, options: AppOptions) {
        if (enable) {
            const granted = await chrome.permissions.request({ origins: ["<all_urls>"] });
            if (options.showBlogIconInNotifications) {
                options.showBlogIconInNotifications = granted;
            }

            if (options.showThumbnailInNotifications) {
                options.showThumbnailInNotifications = granted;
            }
        }
    }
}
