import { createTheme } from "@mantine/core";

export const compactTheme = createTheme({
  primaryColor: "gray",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif',
  spacing: {
    xs: "0.375rem",
    sm: "0.5rem",
    md: "0.75rem",
    lg: "1rem",
    xl: "1.25rem",
  },
  fontSizes: { xs: "0.75rem", sm: "0.8125rem", md: "0.875rem", lg: "1rem" },
  headings: {
    sizes: {
      h1: { fontSize: "1.5rem", lineHeight: "1.3" },
      h2: { fontSize: "1.25rem", lineHeight: "1.3" },
      h3: { fontSize: "1.125rem", lineHeight: "1.3" },
      h4: { fontSize: "1rem", lineHeight: "1.3" },
    },
  },
  defaultRadius: "sm",
  components: {
    Button: { defaultProps: { size: "xs" } },
    TextInput: { defaultProps: { size: "sm" } },
    Textarea: { defaultProps: { size: "sm" } },
    Select: { defaultProps: { size: "sm" } },
    MultiSelect: { defaultProps: { size: "sm" } },
    TagsInput: { defaultProps: { size: "sm" } },
    SegmentedControl: { defaultProps: { size: "xs" } },
    Table: { defaultProps: { verticalSpacing: 4, horizontalSpacing: 8 } },
  },
});
