import React, { InputHTMLAttributes } from 'react';

interface OptionsInputProps extends InputHTMLAttributes<HTMLInputElement> {
  messageId: string;
}

const OptionsInput: React.FC<OptionsInputProps> = ({ messageId, ...inputProps }) => {
  return (
    <label>
      {chrome.i18n.getMessage(messageId) || messageId}
      <input
        {...inputProps}
      />
    </label>
  );
};

export default OptionsInput;
