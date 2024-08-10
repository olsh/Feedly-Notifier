export abstract class StorageArea {
    public static async get(): Promise<chrome.storage.StorageArea> {
        const result = await chrome.storage.local.get('useSync');
        const useSync = result.useSync ?? true;
        const storageArea = useSync ? chrome.storage.sync : chrome.storage.local;
        return storageArea;
    };
}
