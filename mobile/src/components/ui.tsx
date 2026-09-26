import type { PropsWithChildren } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import { colors, radius, space } from "../theme";

export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Heading({ children }: PropsWithChildren) {
  return <Text style={styles.heading}>{children}</Text>;
}

export function Body({ children, muted }: PropsWithChildren<{ muted?: boolean }>) {
  return <Text style={[styles.body, muted && styles.muted]}>{children}</Text>;
}

export function Bullets({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <View style={styles.bullets}>
      {items.map((item, i) => (
        <View key={i} style={styles.bulletRow}>
          <Text style={styles.bulletDot}>•</Text>
          <Text style={styles.body}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

export function Tag({ label, tone }: { label: string; tone?: "high" | "medium" | "low" }) {
  return (
    <View style={[styles.tag, tone && styles[tone]]}>
      <Text style={styles.tagText}>{label}</Text>
      {tone ? <Text style={styles.tagTone}>{tone}</Text> : null}
    </View>
  );
}

export function Tags({ children }: PropsWithChildren) {
  return <View style={styles.tags}>{children}</View>;
}

export function Button({
  title,
  onPress,
  disabled,
  variant = "primary",
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "outline" | "danger";
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        variant === "outline" && styles.buttonOutline,
        variant === "danger" && styles.buttonDanger,
        (disabled || pressed) && styles.buttonDim,
      ]}
    >
      <Text style={[styles.buttonText, variant === "outline" && styles.buttonOutlineText]}>{title}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  optional,
  ...inputProps
}: { label: string; hint?: string; optional?: boolean } & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {optional ? <Text style={styles.muted}> (optional)</Text> : null}
      </Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <TextInput
        multiline
        textAlignVertical="top"
        placeholderTextColor={colors.muted}
        style={styles.input}
        {...inputProps}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: space.xl,
    marginBottom: space.lg,
  },
  heading: { color: colors.text, fontSize: 18, fontWeight: "700", marginBottom: space.sm },
  body: { color: colors.text, fontSize: 16, lineHeight: 23, flexShrink: 1 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  bullets: { marginTop: space.sm, gap: space.xs },
  bulletRow: { flexDirection: "row", gap: space.sm },
  bulletDot: { color: colors.accent, fontSize: 16, lineHeight: 23 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm },
  tag: {
    flexDirection: "row",
    alignItems: "baseline",
    backgroundColor: colors.card2,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.card2,
  },
  tagText: { color: colors.text, fontSize: 14 },
  tagTone: { color: colors.muted, fontSize: 11, marginLeft: 6 },
  high: { borderColor: colors.ok },
  medium: { borderColor: colors.accent },
  low: { borderColor: colors.muted, borderStyle: "dashed" },
  button: {
    backgroundColor: colors.accentStrong,
    borderRadius: radius.pill,
    paddingVertical: 14,
    paddingHorizontal: 28,
    alignItems: "center",
  },
  buttonOutline: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.accent },
  buttonDanger: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.danger },
  buttonDim: { opacity: 0.6 },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  buttonOutlineText: { color: colors.accent, fontWeight: "400" },
  field: { marginBottom: space.lg },
  label: { color: colors.text, fontWeight: "700", fontSize: 16 },
  hint: { color: colors.muted, fontSize: 13, marginTop: 2 },
  input: {
    marginTop: 6,
    backgroundColor: colors.bg,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.input,
    padding: space.md,
    fontSize: 16,
    minHeight: 96,
  },
});
