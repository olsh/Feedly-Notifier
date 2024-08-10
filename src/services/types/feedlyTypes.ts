export type ApiUrlDetails = {
    method: "GET" | "POST";
    parameters: URLSearchParams;
    skipAuthHeader: boolean;
    body?: any;
}

export type AuthData = {
    accessToken: string;
    refreshToken: string;
    feedlyUserId: string;
}

export type Category = {
    id: string;
    label: string;
}

export type Profile = {
    name: string;
    email: string;
}

export type MarkerCount = {
    id: string;
    count: number;
    updated: number;
}

export type MarkerCountsResponse = {
    unreadcounts: MarkerCount[];
    updated: number;
}

export type Subscription = {
    id: string;
    title: string;
    website: string;
    categories: Category[];
    updated: number;
    state: string;
    topics: string[];
    subscribers: number;
    velocity: number;
    visualUrl: string;
    coverUrl: string;
    iconUrl: string;
    partial: boolean;
}

export type StreamContent = {
    id: string;
    title: string;
    author: string;
    crawled: number;
    origin: Origin;
    content?: Content;
    summary?: Content;
    engagement: number;
    engagementRate: number;
    tags: Tag[];
    categories: Category[];
    thumbnail?: Thumbnail[];
    alternate?: Alternate[];

}

export type Origin = {
    streamId: string;
    title: string;
    htmlUrl: string;
}

export type Content = {
    content: string;
    direction: string;
}

export type Tag = {
    id: string;
    label: string;
}

export type Thumbnail = {
    url: string;
}

export type Alternate = {
    type: string;
    href: string;
}

export type StreamsContentResponse = {
    id: string;
    updated: number;
    items: StreamContent[];
}

export type Feed = {
    title: string;
    titleDirection?: string,
    url?: string;
    blog?: string;
    blogTitleDirection?: string;
    blogUrl?: string;
    blogIcon: string;
    id: string;
    content?: string;
    contentDirection?: string;
    isoDate: string;
    date: Date;
    isSaved: boolean;
    categories: Category[];
    author: string;
    thumbnail?: string;
    showEngagement: boolean;
    engagement: number;
    engagementPostfix: string;
    engagementRate: number;
    isEngagementHot: boolean;
    isEngagementOnFire: boolean;
}
