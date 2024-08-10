import { Category } from "../services/types/feedlyTypes"

export type AppOptions = {
    //general options
    updateInterval: number;
    markReadOnClick: boolean;
    showCounter: boolean;
    grayIconColorIfNoUnread: boolean;
    resetCounterOnClick: boolean;
    enableBackgroundMode: boolean;
    disableOptionsSync: boolean;

    //popup options
    openSiteOnIconClick: boolean;
    openFeedsInBackground: boolean;
    abilitySaveFeeds: boolean;
    maxNumberOfFeeds: number;
    sortBy: string;
    theme: string;
    popupFontSize: number;
    popupWidth: number;
    expandedPopupWidth: number;
    showFullFeedContent: boolean;
    showCategories: boolean;
    forceUpdateFeeds: boolean;
    openFeedsInSameTab: boolean;
    expandFeeds: boolean;
    closePopupWhenLastFeedIsRead: boolean

    //notifications options
    showDesktopNotifications: boolean;
    showBlogIconInNotifications: boolean;
    showThumbnailInNotifications: boolean;
    maxNotificationsCount: number;
    playSound: boolean;
    soundVolume: number;
    sound: string

    //filters options
    isFiltersEnabled: boolean;
    filters: string[];
    showEngagementFilter: boolean;
    engagementFilterLimit: number;
}


export const defaultOptions: AppOptions = {
    updateInterval: 10,
    markReadOnClick: true,
    showCounter: true,
    grayIconColorIfNoUnread: false,
    resetCounterOnClick: false,
    enableBackgroundMode: false,
    disableOptionsSync: false,

    openSiteOnIconClick: false,
    openFeedsInBackground: true,
    abilitySaveFeeds: false,
    maxNumberOfFeeds: 20,
    sortBy: 'newest',
    theme: 'light',
    popupFontSize: 100,
    popupWidth: 380,
    expandedPopupWidth: 650,
    showFullFeedContent: false,
    showCategories: false,
    forceUpdateFeeds: false,
    openFeedsInSameTab: false,
    expandFeeds: false,
    closePopupWhenLastFeedIsRead: false,

    showDesktopNotifications: true,
    showBlogIconInNotifications: false,
    showThumbnailInNotifications: false,
    maxNotificationsCount: 10,
    playSound: true,
    soundVolume: 0.8,
    sound: 'sound/alert.mp3',

    isFiltersEnabled: true,
    filters: [],
    showEngagementFilter: false,
    engagementFilterLimit: 1
};
