'use client';

import { type ClipboardEvent, type KeyboardEvent, type ReactNode, useMemo, useState } from 'react';

import { FileIcon, X } from 'lucide-react';
import { type Accept, useDropzone } from 'react-dropzone';
import { type ControllerRenderProps, type FieldValues, type Path } from 'react-hook-form';

import { Badge } from './badge';
import { Button } from './button';
import { Checkbox } from './checkbox';
import DateInput from './date-input';
import { Input } from './input';
import { Progress } from './progress';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from './select';
import { Textarea } from './textarea';

import { cn } from '../lib/utils';

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) {
    return '0 Bytes';
  }

  const units = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  const size = bytes / Math.pow(k, i);

  return `${size.toFixed(2)} ${units[i]}`;
};

type SelectOption = {
  label: string;
  value: string;
};

export type DynamicFormField<T extends FieldValues = FieldValues> = {
  name: Path<T>;
  label: string | ReactNode;
  type: keyof typeof RenderedFormFields;
  placeholder?: string;
  description?: string;
  options?: SelectOption[];
  min?: number;
  max?: number;
  step?: number;
  render?: (field: ControllerRenderProps<T, Path<T>>) => ReactNode;
  displayCondition?: ((values: T) => boolean) | boolean;
  maxFiles?: number;
  accept?: Accept;
};

type FieldProps<T extends FieldValues = FieldValues> = {
  field: ControllerRenderProps<T, Path<T>>;
  formField: DynamicFormField<T>;
  id: string;
};

const RenderedStringArrayInput = <T extends FieldValues = FieldValues>(props: FieldProps<T>) => {
  const [value, setValue] = useState<string>('');
  const currentValues = Array.isArray(props.field.value) ? (props.field.value as string[]) : [];

  const addValue = (nextValue: string) => {
    const trimmed = nextValue.trim();
    if (trimmed.length === 0) {
      return;
    }

    props.field.onChange(Array.from(new Set([...currentValues, trimmed])));
    setValue('');
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === ',' || event.key === 'Enter') {
      event.preventDefault();
      addValue(value);
    }
  };

  const handleBlur = () => {
    addValue(value);
    props.field.onBlur();
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();

    const pasteData = event.clipboardData.getData('text');
    const values = pasteData
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    if (values.length > 0) {
      props.field.onChange(Array.from(new Set([...currentValues, ...values])));
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {currentValues.map((item) => (
          <Badge key={item} className="max-w-[320px] px-2 py-1" variant="secondary">
            <span className="min-w-0 truncate">{item}</span>
            <button
              className="text-muted-foreground hover:text-foreground ml-2"
              title="Remove"
              type="button"
              onClick={() => {
                props.field.onChange(currentValues.filter((currentItem) => currentItem !== item));
              }}
            >
              <X size={14} />
            </button>
          </Badge>
        ))}
      </div>
      <Input
        placeholder="Type and press Enter or comma to add"
        value={value}
        onBlur={handleBlur}
        onChange={(event) => {
          setValue(event.target.value);
        }}
        onKeyDown={handleInputKeyDown}
        onPaste={handlePaste}
      />
    </>
  );
};

const RenderedTimeInput = <T extends FieldValues = FieldValues>(props: FieldProps<T>) => (
  <Input placeholder={props.formField.placeholder} type="time" {...props.field} />
);

const RenderedDateInput = <T extends FieldValues = FieldValues>(props: FieldProps<T>) => {
  const fieldDateRaw: unknown = props.field.value;
  if (!(fieldDateRaw instanceof Date)) {
    return null;
  }
  const fieldDate = fieldDateRaw;

  return (
    <DateInput
      date={fieldDate}
      onChange={(date) => {
        const updatedDate = new Date(fieldDate);
        updatedDate.setDate(date.getDate());
        updatedDate.setMonth(date.getMonth());
        updatedDate.setFullYear(date.getFullYear());
        props.field.onChange(updatedDate);
      }}
    />
  );
};

const RenderedDatetimeInput = <T extends FieldValues = FieldValues>(props: FieldProps<T>) => {
  const fieldDateRaw: unknown = props.field.value;
  if (!(fieldDateRaw instanceof Date)) {
    return null;
  }
  const fieldDate = fieldDateRaw;

  const pad = (value: number) => value.toString().padStart(2, '0');
  const timeValue = `${pad(fieldDate.getHours())}:${pad(fieldDate.getMinutes())}:${pad(fieldDate.getSeconds())}`;

  return (
    <div className="flex gap-4">
      <DateInput
        date={fieldDate}
        onChange={(date) => {
          const updatedDate = new Date(fieldDate);
          updatedDate.setDate(date.getDate());
          updatedDate.setMonth(date.getMonth());
          updatedDate.setFullYear(date.getFullYear());
          props.field.onChange(updatedDate);
        }}
      />
      <Input
        className="bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
        step="1"
        type="time"
        value={timeValue}
        onChange={(event) => {
          const [hours = '0', minutes = '0', seconds = '0'] = event.target.value.split(':');
          const h = Number.parseInt(hours, 10);
          const m = Number.parseInt(minutes, 10);
          const s = Number.parseInt(seconds, 10);
          const time = new Date(fieldDate);
          time.setHours(Number.isNaN(h) ? 0 : h);
          time.setMinutes(Number.isNaN(m) ? 0 : m);
          time.setSeconds(Number.isNaN(s) ? 0 : s);
          props.field.onChange(time);
        }}
      />
    </div>
  );
};

const RenderedCustomInput = <T extends FieldValues = FieldValues>(props: FieldProps<T>) => {
  if (props.formField.render === undefined) {
    return <div>formField.render is undefined</div>;
  }

  return <>{props.formField.render(props.field)}</>;
};

const RenderedRadioInput = <T extends FieldValues = FieldValues>(props: FieldProps<T>) => {
  const options = props.formField.options ?? [];

  return (
    <div className="flex flex-col gap-2">
      {options.map((option) => (
        <label key={option.value} className="flex items-center gap-2">
          <Input
            checked={props.field.value === option.value}
            type="radio"
            value={option.value}
            onChange={(event) => {
              props.field.onChange(event.target.value);
            }}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
};

const RenderedSelectInput = <T extends FieldValues = FieldValues>(props: FieldProps<T>) => {
  const options = props.formField.options ?? [];

  return (
    <Select value={props.field.value as string} onValueChange={props.field.onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={props.formField.placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>{props.formField.label}</SelectLabel>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
};

const RenderedColorInput = <T extends FieldValues = FieldValues>(props: FieldProps<T>) => (
  <Input type="color" {...props.field} />
);

const RenderedCheckboxInput = <T extends FieldValues = FieldValues>(props: FieldProps<T>) => (
  <Checkbox
    checked={props.field.value as boolean}
    id={props.id}
    onCheckedChange={(checked) => {
      props.field.onChange(checked);
    }}
  />
);

type LocalFile = File & {
  key: string;
  uploadProgress: number;
  uploadStatus: 'done';
};

const isLocalFile = (file: LocalFile | string): file is LocalFile => {
  return typeof file === 'object' && 'uploadProgress' in file;
};

const RenderedFileUploadInput = <T extends FieldValues = FieldValues>(props: FieldProps<T>) => {
  const [files, setFiles] = useState<LocalFile[]>([]);
  const currentValue = useMemo(
    () => (Array.isArray(props.field.value) ? (props.field.value as string[]) : []),
    [props.field.value],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles: File[]) => {
      const localFiles = acceptedFiles.map((file) =>
        Object.assign(file, {
          uploadStatus: 'done' as const,
          uploadProgress: 100,
          key: file.name,
        }),
      );

      setFiles((prevFiles) => [...prevFiles, ...localFiles]);

      const nextFileKeys = localFiles.map((file) => file.key);
      props.field.onChange([...new Set([...currentValue, ...nextFileKeys])]);
    },
    accept: props.formField.accept,
    maxFiles: props.formField.maxFiles,
  });

  const removeFile = (file: LocalFile | string) => {
    if (isLocalFile(file)) {
      setFiles((prevFiles) => prevFiles.filter((prevFile) => prevFile.name !== file.name));
      props.field.onChange(currentValue.filter((propsFile) => propsFile !== file.key));
      return;
    }

    props.field.onChange(currentValue.filter((propsFile) => propsFile !== file));
  };

  const previouslyUploadedFiles = useMemo(
    () =>
      currentValue.filter((fileKey) => files.find((file) => file.key === fileKey) === undefined),
    [currentValue, files],
  );

  return (
    <div className="flex flex-col gap-2">
      {props.formField.maxFiles === undefined ||
      props.formField.maxFiles === 0 ||
      currentValue.length < props.formField.maxFiles ? (
        <div
          {...getRootProps()}
          className={cn(
            isDragActive ? 'border-primary bg-primary/10 ring-primary/20' : 'border-input',
            'dark:bg-input/30 flex justify-center rounded-none border bg-transparent px-6 py-20 transition-colors duration-200',
          )}
        >
          <div>
            <FileIcon aria-hidden className="text-muted-foreground/80 mx-auto h-12 w-12" />
            <div className="text-muted-foreground mt-4 flex">
              <p>Drag and drop or</p>
              <label
                className="text-primary hover:text-primary/80 relative cursor-pointer rounded-sm pl-1 font-medium hover:underline hover:underline-offset-4"
                htmlFor="file"
              >
                <span>choose file(s)</span>
                <input
                  {...getInputProps()}
                  className="sr-only"
                  id="file-upload"
                  name="file-upload"
                  type="file"
                />
              </label>
              <p className="pl-1">to upload</p>
            </div>
          </div>
        </div>
      ) : null}
      <div>
        {[...files, ...previouslyUploadedFiles].map((file) => (
          <div
            key={isLocalFile(file) ? file.key : file}
            className="border-border/50 relative gap-2 border-b py-2 last:border-b-0"
          >
            <div className="flex items-center space-x-2.5">
              <span className="bg-background ring-border flex h-10 w-10 shrink-0 items-center justify-center rounded-sm shadow-sm ring-1 ring-inset">
                <FileIcon aria-hidden className="text-foreground h-5 w-5" />
              </span>
              {isLocalFile(file) ? (
                <div className="w-full">
                  <p className="text-foreground text-xs font-medium">{file.name}</p>
                  <p className="text-muted-foreground mt-0.5 flex justify-between text-xs">
                    <span>{formatFileSize(file.size)}</span>
                    <span>{file.uploadStatus}</span>
                  </p>
                </div>
              ) : (
                <div className="w-full">
                  <p className="text-foreground text-xs font-medium">{file}</p>
                </div>
              )}
              <Button
                aria-label="Remove"
                className="text-muted-foreground hover:text-foreground h-8 w-8"
                size="icon"
                type="button"
                variant="ghost"
                onClick={() => {
                  removeFile(file);
                }}
              >
                <X aria-hidden className="h-5 w-5 shrink-0" />
              </Button>
            </div>
            {isLocalFile(file) && (
              <div className="flex items-center space-x-3">
                <Progress className="h-1.5" value={file.uploadProgress} />
                <span className="text-muted-foreground text-xs">{file.uploadProgress}%</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export const RenderedFormFields: {
  [key: string]: <T extends FieldValues>(props: FieldProps<T>) => ReactNode;
} = {
  input: (props) => (
    <Input placeholder={props.formField.placeholder} {...props.field} id={props.id} />
  ),
  number: (props) => (
    <Input
      max={props.formField.max}
      min={props.formField.min}
      placeholder={props.formField.placeholder}
      step={props.formField.step}
      type="number"
      {...props.field}
      id={props.id}
    />
  ),
  textarea: (props) => (
    <Textarea placeholder={props.formField.placeholder} {...props.field} id={props.id} />
  ),
  password: (props) => (
    <Input
      placeholder={props.formField.placeholder}
      type="password"
      {...props.field}
      id={props.id}
    />
  ),
  email: (props) => (
    <Input placeholder={props.formField.placeholder} type="email" {...props.field} id={props.id} />
  ),
  tel: (props) => (
    <Input placeholder={props.formField.placeholder} type="tel" {...props.field} id={props.id} />
  ),
  url: (props) => (
    <Input placeholder={props.formField.placeholder} type="url" {...props.field} id={props.id} />
  ),
  date: RenderedDateInput,
  time: RenderedTimeInput,
  datetime: RenderedDatetimeInput,
  checkbox: RenderedCheckboxInput,
  color: RenderedColorInput,
  select: RenderedSelectInput,
  radio: RenderedRadioInput,
  custom: RenderedCustomInput,
  stringArray: RenderedStringArrayInput,
  file: RenderedFileUploadInput,
};

export const RenderFormInput = <T extends FieldValues = FieldValues>({
  type,
  field,
  formField,
  id,
}: {
  type: keyof typeof RenderedFormFields;
  field: ControllerRenderProps<T, Path<T>>;
  formField: DynamicFormField<T>;
  id: string;
}) => {
  const RenderedInput = RenderedFormFields[type];
  if (RenderedInput === undefined) {
    return null;
  }

  return <RenderedInput field={field} formField={formField} id={id} />;
};

export const RenderLabelAfter: Partial<keyof typeof RenderedFormFields> = 'checkbox';
