import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppOptions } from "./options/appOptions";
import { OptionsService } from "./services/optionsService";
import { Utils } from "./utils/utils";
import OptionsInput from "./components/options/optionsInput";
import OptionsSelect from "./components/options/optionsSelect";
import { Category, Profile } from "./services/types/feedlyTypes";
import FiltersList from "./components/options/filtersList";

const Options = () => {
  const defaultOptions = OptionsService.getDefaultOptions();
  const initialOptions = useRef<AppOptions>(structuredClone(defaultOptions));
  const [options, setOptions] = useState<AppOptions>(defaultOptions);
  const [categories, setCategories] = useState<Category[]>([]);
  const [profile, setProfile] = useState<Profile|null>(null);

  const isChanged = initialOptions && !Utils.deepEqual(initialOptions.current, options);

  useEffect(() => {
    chrome.runtime.sendMessage({ action: 'getOptions' }, (options) => {
      setOptions(options);
      initialOptions.current = structuredClone(options);
    });

    chrome.runtime.sendMessage({ action: 'getOptionsFeedlyData' }, (data) => {
      setCategories(data[0]);
      setProfile(data[1]);
    });
  }, []);

  const saveOptions = () => {
    chrome.runtime.sendMessage({ action: 'setOptions', data: options }, (options) => {
      initialOptions.current = structuredClone(options);
      alert(chrome.i18n.getMessage("OptionsSaved"));
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { id, name, value, type } = e.target;

    setOptions((prevOptions) => {
      const newOptions = { ...prevOptions };
      const keys = name.split('.');

      let current: any = newOptions;

      for (let i = 0; i < keys.length - 1; i++) {
        current = current[keys[i]];
      }

      switch (type) {
        case 'number':
          current[keys[keys.length - 1]] = parseInt(value);
          break;
        case 'range':
          current[keys[keys.length - 1]] = parseFloat(value);
          break;
        case 'checkbox':
          const checked = (e.target as HTMLInputElement).checked
          if (name != 'filters') {
            current[keys[keys.length - 1]] = checked;
          } else {
            if (newOptions.filters === undefined)
              newOptions.filters = [];
            if (checked) {
              newOptions.filters.push(id);
            } else {
              newOptions.filters = newOptions.filters.filter((category) => category !== id);
            }
          }
          break;
        default:
          current[keys[keys.length - 1]] = value;
      }

      if (id === 'sound') {
        playSound();
      }

      return newOptions;
    });
  };

  const playSound = () => {
    var audio = new Audio(options.sound);
    audio.volume = options.soundVolume;
    audio.play();
  }

  const logout = () => {
    chrome.runtime.sendMessage({ action: 'logout' }, () => {
      setProfile(null);
    });
  }

  return (
    <>
      <header>{chrome.i18n.getMessage("FeedlyNotifierOptions")}</header>
      <main>
        <form onSubmit={(e) => { e.preventDefault(); saveOptions(); }}>
          <section>
            <h3>{chrome.i18n.getMessage('General')}</h3>

            <OptionsInput messageId="IntervalPeriod" name="updateInterval" type="number" min={10} max={120} value={options.updateInterval} onChange={handleChange} />
            <OptionsInput messageId="AutoMarkRead" name="markReadOnClick" type="checkbox" checked={options.markReadOnClick} onChange={handleChange} />
            <OptionsInput messageId="ShowCounter" name="showCounter" type="checkbox" checked={options.showCounter} onChange={handleChange} />
            <OptionsInput messageId="GrayIconColorIfNoUnread" name="grayIconColorIfNoUnread" type="checkbox" checked={options.grayIconColorIfNoUnread} onChange={handleChange} />
            <OptionsInput messageId="ResetCounterOnClick" name="resetCounterOnClick" type="checkbox" checked={options.resetCounterOnClick} onChange={handleChange} />

            { Browser === 'chrome' &&
              <OptionsInput messageId="EnableBackgroundMode" id="enableBackgroundMode" name="enableBackgroundMode" type="checkbox" checked={options.enableBackgroundMode} onChange={handleChange} />
            }
            <OptionsInput messageId="DisableOptionsSync" name="disableOptionsSync" type="checkbox" checked={options.disableOptionsSync} onChange={handleChange} />

            <h3>{chrome.i18n.getMessage('Popup')}</h3>

            <OptionsInput messageId="OpenSiteOnIconClick" name="openSiteOnIconClick" type="checkbox" checked={options.openSiteOnIconClick} onChange={handleChange} />
            <OptionsInput messageId="OpenFeedsInBackground" name="openFeedsInBackground" type="checkbox" checked={options.openFeedsInBackground} onChange={handleChange} />
            <OptionsInput messageId="AbilitySaveFeeds" name="abilitySaveFeeds" type="checkbox" checked={options.abilitySaveFeeds} onChange={handleChange} />
            <OptionsInput messageId="MaxNumberOfFeeds" name="maxNumberOfFeeds" type="number" min={1} max={500} value={options.maxNumberOfFeeds} onChange={handleChange} />
            <OptionsSelect messageId="Sorting" name="sortBy" value={options.sortBy} onChange={handleChange}
              data={[
                { value: 'newest', title: chrome.i18n.getMessage('NewestFirst') },
                { value: 'oldest', title: chrome.i18n.getMessage('OldestFirst') },
                { value: 'engagement', title: chrome.i18n.getMessage('EngagementRate') }
              ]} />
            <OptionsSelect messageId="Theme" name="theme" value={options.theme} onChange={handleChange}
              data={[
                { value: 'light', title: chrome.i18n.getMessage('Light') },
                { value: 'dark', title: chrome.i18n.getMessage('Dark') },
                { value: 'nord', title: chrome.i18n.getMessage('Nord') }
              ]} />
            <OptionsInput messageId="PopupFontSize" name="popupFontSize" type="number" min={70} max={150} value={options.popupFontSize} onChange={handleChange} />
            <OptionsInput messageId="PopupWidth" name="popupWidth" type="number" min={380} max={750} value={options.popupWidth} onChange={handleChange} />
            <OptionsInput messageId="ExpandedPopupWidth" name="expandedPopupWidth" type="number" min={380} max={750} value={options.expandedPopupWidth} onChange={handleChange} />
            <OptionsInput messageId="ShowFullFeedContent" name="showFullFeedContent" type="checkbox" checked={options.showFullFeedContent} onChange={handleChange} />
            <OptionsInput messageId="ShowCategories" name="showCategories" type="checkbox" checked={options.showCategories} onChange={handleChange} />
            <OptionsInput messageId="ForceUpdateFeeds" name="forceUpdateFeeds" type="checkbox" checked={options.forceUpdateFeeds} onChange={handleChange} />
            <OptionsInput messageId="OpenFeedsInSameTab" name="openFeedsInSameTab" type="checkbox" checked={options.openFeedsInSameTab} onChange={handleChange} />
            <OptionsInput messageId="ExpandFeeds" name="expandFeeds" type="checkbox" checked={options.expandFeeds} onChange={handleChange} />
            <OptionsInput messageId="ClosePopupWhenLastFeedIsRead" name="closePopupWhenLastFeedIsRead" type="checkbox" checked={options.closePopupWhenLastFeedIsRead} onChange={handleChange} />

            <h3>{chrome.i18n.getMessage('Notifications')}</h3>

            <OptionsInput messageId="ShowDesktopNotifications" name="showDesktopNotifications" type="checkbox" checked={options.showDesktopNotifications} onChange={handleChange} />
            <OptionsInput messageId="ShowBlogIconInNotifications" name="showBlogIconInNotifications" type="checkbox" checked={options.showBlogIconInNotifications} onChange={handleChange} />

            { Browser == 'chrome' &&
              <OptionsInput messageId="ShowThumbnailInNotifications" name="showThumbnailInNotifications" type="checkbox" checked={options.showThumbnailInNotifications} onChange={handleChange} />
            }

            { Browser != 'firefox' &&
              <OptionsInput messageId="MaxNotificationsCount" name="maxNotificationsCount" type="number" min={1} max={100} value={options.maxNotificationsCount} onChange={handleChange} />
            }

            {/* Opera doesn't support silent notifications at the moment and uses system notification sound */}
            { Browser != 'opera' &&
              <>
                <OptionsInput messageId="PlaySound" name="playSound" type="checkbox" checked={options.playSound} onChange={handleChange} />
                <OptionsInput messageId="SoundVolume" name="soundVolume" type="range" min={0.01} max={1} step={0.01} value={options.soundVolume} onChange={handleChange} onMouseUp={playSound} />
                <OptionsSelect messageId="Sound" id="sound" name="sound" value={options.sound} onChange={handleChange}
                  data={[
                    { value: 'sound/alert.mp3', title: 'Alert' },
                    { value: 'sound/no-problem.mp3', title: 'No problem' },
                    { value: 'sound/whistling.mp3', title: 'Whistling' },
                    { value: 'sound/quite-impressed.mp3', title: 'Quite impressed' },
                    { value: 'sound/light-hearted.mp3', title: 'Light hearted' }
                  ]} />
              </>
            }
            <br />
            {profile &&
            <>
              <h3>{chrome.i18n.getMessage('Filters')}</h3>

              <OptionsInput messageId="UpdateFollowingCategories" name="isFiltersEnabled" type="checkbox" checked={options.isFiltersEnabled} onChange={handleChange} />

              <fieldset id="categories">
                <legend>{chrome.i18n.getMessage('Categories')}</legend>
                {categories.length > 0 && <FiltersList filters={categories} selected={options.filters} onChange={handleChange} />}
              </fieldset>

              <OptionsInput messageId="ShowEngagementFilter" name="showEngagementFilter" type="checkbox" checked={options.showEngagementFilter} onChange={handleChange} />
              <OptionsInput messageId="EngagementFilterLimit" name="engagementFilterLimit" type="number" min={1} max={10000} value={options.engagementFilterLimit} onChange={handleChange} />
            </>
            }
          </section>
          <button id="save" className="button" type="submit" disabled={!isChanged}>{chrome.i18n.getMessage('Save')}</button>
          <button className="button" onClick={(e) => { e.preventDefault(); chrome.runtime.sendMessage({ action: 'clearStorage' }); }}>Clear storage</button>
        </form>
        {profile &&
          <div id="userInfo">
            <section>
              <span className="label">{chrome.i18n.getMessage('CurrentUser')} {profile.name}</span><br/>
              <span className="label">Email {profile.email}</span>
            </section>
            <button type="button" className="button" onClick={logout} >{chrome.i18n.getMessage('Logout')}</button>
          </div>
        }
      </main>
    </>
  );
};

const root = createRoot(document.getElementById("root")!);

root.render(
  <React.StrictMode>
    <Options />
  </React.StrictMode>
);
