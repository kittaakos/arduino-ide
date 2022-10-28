import * as React from '@theia/core/shared/react';
import Select, { Props } from 'react-select/dist/declarations/src/Select';
import { StylesConfig } from 'react-select/dist/declarations/src/styles';
import { GroupBase } from 'react-select/dist/declarations/src/types';
import { ThemeConfig } from 'react-select/dist/declarations/src/theme';

export class ArduinoSelect<
  T,
  IsMulti extends boolean = false,
  Group extends GroupBase<T> = GroupBase<T>
> extends Select<T, IsMulti, Group> {
  constructor(props: Readonly<Props<T, IsMulti, Group>>) {
    super(props);
  }

  override render(): JSX.Element {
    const controlHeight = 27; // from `monitor.css` -> `.serial-monitor-container .head` (`height: 27px;`)
    const styles: StylesConfig<T, IsMulti, Group> = {
      control: (styles) => ({
        ...styles,
        minWidth: 120,
        color: 'var(--theia-foreground)',
      }),
      dropdownIndicator: (styles) => ({
        ...styles,
        padding: 0,
      }),
      indicatorSeparator: () => ({
        display: 'none',
      }),
      indicatorsContainer: () => ({
        padding: '0px 5px',
      }),
      menu: (styles) => ({
        ...styles,
        marginTop: 0,
      }),
    };
    const theme: ThemeConfig = (theme) => ({
      ...theme,
      borderRadius: 0,
      spacing: {
        controlHeight,
        baseUnit: 2,
        menuGutter: 4,
      },
      colors: {
        ...theme.colors,
        // `primary50`??? it's crazy but apparently, without this, we would get a light-blueish
        // color when selecting an option in the select by clicking and then not releasing the button.
        // https://react-select.com/styles#overriding-the-theme
        primary50: 'var(--theia-list-activeSelectionBackground)',
      },
    });
    const DropdownIndicator = () => <span className="fa fa-caret-down caret" />;
    return (
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      <Select
        {...this.props}
        className="theia-select"
        components={{ DropdownIndicator }}
        theme={theme}
        styles={styles}
        classNamePrefix="arduino-select"
        isSearchable={false}
      />
    );
  }
}
