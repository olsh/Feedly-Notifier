import React from 'react';
import { Category } from '../../services/types/feedlyTypes';
import OptionsInput from './optionsInput';

interface FiltersListProps {
    filters: Category[];
    selected: string[];
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
}

const FiltersList: React.FC<FiltersListProps> = (props) => {
  props.filters = props.filters || [];
  props.selected = props.selected || [];

  return (
    <>
    {props.filters.map((category, index) => {
        return <OptionsInput messageId={category.label} id={category.id} name="filters" type="checkbox" checked={isSelected(props.selected, category.id)} onChange={props.onChange} />
    })}
    </>
  );
};

function isSelected(selected: string[], id: string): boolean {
  return selected.some(x => x === id);
}

export default FiltersList;
