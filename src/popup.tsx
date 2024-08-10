import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { FeedlyService } from "./services/feedlyService";
import { OptionsService } from "./services/optionsService";
import { AppOptions } from "./options/appOptions";
import { Feed } from "./services/types/feedlyTypes";
import { sidebarAction } from "webextension-polyfill";
import FeedsList from "./components/options/feedsList";

const Popup = () => {
  const [loggedIn, setLoggedIn] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [options, setOptions] = useState<AppOptions>(OptionsService.getDefaultOptions());
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [isSidebar, setIsSidebar] = useState<boolean>(false);

  useEffect(() => {
    if (Browser == "firefox" && sidebarAction.isOpen) {
      sidebarAction.isOpen({}).then((isOpen) => {
        setIsSidebar(isOpen);
      });
    } else {
      setIsSidebar(false);
    }

    Promise.all([
      FeedlyService.getAuthState().then((auth) => {
        setLoggedIn(auth != null);
        console.log(auth != null);
      }),
      OptionsService.getOptionsFromStorage().then((options) => {
        setOptions(options);
        setTheme(options.theme);
      }),
      chrome.runtime.sendMessage({ action: 'getFeeds' }, (feeds) => {
        setFeeds(feeds || []);
      })
    ]).then(() => {
      setLoading(false);
    });
  }, []);

  async function login(): Promise<void> {
    await chrome.runtime.sendMessage({ action: 'login' });
  }

  function setTheme(theme: string) {
    switch (theme) {
        case "dark":
            document.body.setAttribute('data-theme', 'dark');
            break;
        case "nord":
            document.body.setAttribute('data-theme', 'nord');
            break;
        default: {
            document.body.removeAttribute('data-theme');
        }
    }
}

  return (
    <>
      {!loggedIn &&
        <button className="button" onClick={async () => await login()}>{chrome.i18n.getMessage('Login')}</button>
      }
      {loggedIn &&
        <div id="popup-content" className={options.abilitySaveFeeds ? "tabs" : ""}>
          <div id="feedly">
            <div id="feedly-flex">
              <div id="feedly-section">
                <a href="#" id="feedly-logo"></a><a href="#" id="website">{chrome.i18n.getMessage("FeedlyWebsite")}</a>
              </div>
              <div id="tabs-container">
                <div className="tabs-slider-container">
                  <input type="checkbox" className="tabs-slider" id="tabs-checkbox" />
                    <span className="tabs-label-unselected-left glyphicon glyphicon-menu-hamburger"></span>
                    <div className="tabs-trail">
                      <div className="tabs-selected-bg">
                        <span className="tabs-label-selected-left glyphicon glyphicon-menu-hamburger"></span>
                        <span className="tabs-label-selected-right glyphicon glyphicon-time"></span>
                      </div>
                    </div>
                    <span className="tabs-label-unselected-right glyphicon glyphicon-time"></span>
                </div>
              </div>
              <div id="popup-actions">
                <em className="menu-glyphicon glyphicon glyphicon-share" id="open-all-news"><div className="arrow-up"></div><span>{chrome.i18n.getMessage("OpenAllFeeds")}</span></em>
                <em className="menu-glyphicon glyphicon glyphicon-share icon-unsaved" id="open-unsaved-all-news"><div className="arrow-up"></div><span>{chrome.i18n.getMessage("OpenAllSavedFeeds")}</span></em>
                <em className="menu-glyphicon glyphicon glyphicon-ok" id="mark-all-read"><div className="arrow-up"></div><span>{chrome.i18n.getMessage("MarkAllAsRead")}</span></em>
                <em className="menu-glyphicon glyphicon glyphicon-filter" id="mark-read-engagement"><div className="arrow-up"></div><span>{chrome.i18n.getMessage("MarkAsReadEngagement")}</span></em>
                <em className="menu-glyphicon glyphicon glyphicon-refresh icon-refresh" id="update-feeds"><div className="arrow-up"></div><span>{chrome.i18n.getMessage("UpdateFeeds")}</span></em>
              </div>
            </div>
          </div>
          {!loading &&
            <>
            {feeds.length > 0 &&
            <>
            <div id="feed" style={{fontSize: options.popupFontSize/100 + "em"}}>
              <FeedsList feeds={feeds} />
            </div>
            <div id="feed-saved"></div>
            </>
            }
            {feeds.length == 0 &&
              <div id="feed-empty">{chrome.i18n.getMessage("NoUnreadArticles")}</div>
            }
            </>
          }
          {loading &&
            <div id="loading">
              <img src="/images/loading.svg" alt="loading..." />
            </div>
          }
        </div>
      }
    </>
  );
};

const root = createRoot(document.getElementById("root")!);

root.render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>
);
