import { InputHTMLAttributes, forwardRef } from "react";

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ invalid = false, className = "", type = "text", ...rest }, ref) {
    const borderClass = invalid
      ? "border-red-400 focus:ring-red-500"
      : "border-gray-300 focus:ring-blue-500";

    return (
      <input
        ref={ref}
        type={type}
        className={`rounded-lg border px-4 py-3 focus:outline-none focus:ring-2 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed ${borderClass} ${className}`}
        {...rest}
      />
    );
  }
);
