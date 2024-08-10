import React from 'react';
import TimeAgo from 'react-timeago';
import { Feed } from '../../services/types/feedlyTypes';
import OptionsInput from './optionsInput';

interface FeedsListProps {
    feeds: Feed[];
}

const FeedsList: React.FC<FeedsListProps> = (props) => {

  return (
    <div className="items">
    {props.feeds.map((feed, index) => {
        return <div className="item" data-id={feed.id} data-categories={feed.categories.map(category => category.id).join(' ')}>
            <span className={`article-title ${feed.titleDirection}`}>
                <a data-link={feed.url} className="title">{feed.title}</a>
            </span>
            <span className="article-menu">
                <span className={`menu-glyphicon glyphicon glyphicon-bookmark save-feed ${feed.isSaved ? "saved" : ""}}`} data-saved={feed.isSaved}></span>
                <span className="menu-glyphicon glyphicon glyphicon-eye-open mark-read" title="Mark as read"></span>
                <span className="menu-glyphicon glyphicon glyphicon-chevron-down show-content" title="Show content"></span>
            </span>

            <div className={`blog-title ${feed.blogTitleDirection}`}>
                <img className="blog-icon" src={feed.blogIcon}/>
                {feed.showEngagement &&
                  <span className={`engagement ${feed.isEngagementHot ? "hot" : ""} ${feed.isEngagementOnFire ? "on-fire" : ""}`}>{feed.engagement}{feed.engagementPostfix}</span>
                }

                <a data-link={feed.blogUrl} href="javascript:void(0)">{feed.blog},</a>
                <TimeAgo className="timeago" date={feed.isoDate}/>
            </ div>
            {feed.content &&
              <div className="content">{feed.content}</div>
            }
        </div>
    })}
    </div>
  );
};

function isSelected(selected: string[], id: string): boolean {
  return selected.some(x => x === id);
}

export default FeedsList;
