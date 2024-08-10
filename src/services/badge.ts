import { AppOptions } from "../options/appOptions";
import { OptionsService } from "./optionsService";

export abstract class Badge {
    public static setActive() {
        chrome.action.setBadgeBackgroundColor({color: "#CF0016"});
        this.setActiveIcon();
    }

    public static setInactive() {
        this.setInactiveIcon();
        this.setText("");
    }

    public static setActiveIcon() {
        chrome.action.setIcon({ path: {
            "19": "/images/icon.png",
            "38": "/images/icon38.png"
        }});
    }

    public static setInactiveIcon() {
        chrome.action.setIcon({ path: {
            "19": "/images/icon_inactive.png",
            "38": "/images/icon_inactive38.png"
        }});
    }

    public static setText(text: string) {
        chrome.action.setBadgeText({ text: text });
    }

    public static async setBadgeCounterAsync(unreadFeedsCount: number) {
        const options = await OptionsService.getOptionsFromStorage();
        this.setBadgeCount(unreadFeedsCount, options);
    }

    public static setBadgeCount(unreadFeedsCount: number, options: AppOptions) {
        let badgeText = "";

        if (options.showCounter) {
            const unreadFeedsCountNumber = +unreadFeedsCount;

            if (unreadFeedsCountNumber > 999) {
                const thousands = Math.floor(unreadFeedsCountNumber / 1000);
                badgeText = thousands + "k+";
            } else {
                badgeText = String(unreadFeedsCountNumber > 0 ? unreadFeedsCount : "");
            }
            Badge.setText(badgeText);

        } else {
            Badge.setText("");
        }

        if (!unreadFeedsCount && options.grayIconColorIfNoUnread) {
            this.setInactiveIcon();
        } else {
            this.setActiveIcon();
        }

        chrome.storage.local.set({unreadFeedsCount: unreadFeedsCount});
    }
}
