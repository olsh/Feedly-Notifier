import React, { SelectHTMLAttributes  } from 'react';

interface OptionsSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  messageId: string;
  data: {value: string, title: string}[]
}

const OptionsSelect: React.FC<OptionsSelectProps> = ({ messageId, data, ...selectProps }) => {
  return (
    <label>
      {chrome.i18n.getMessage(messageId)}
      <select
        {...selectProps}
      >
        {
          data.map(({ value, title }) => (
            <option value={value}>{title}</option>
          ))
        }
      </select>
    </label>
  );
};

export default OptionsSelect;
