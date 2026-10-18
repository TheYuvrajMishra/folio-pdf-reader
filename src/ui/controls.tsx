/**
 * Button / IconButton / Card / Chip / ProgressBar — the restrained set
 * (DESIGN §3.4, §7). One button style, one card style.
 */
import React from 'react';
import { Text, View, StyleProp, ViewStyle } from 'react-native';
import { LucideIcon } from 'lucide-react-native';
import { button, fontFamilyFor, icon, radius, spacing, touchTarget, type } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import { Pressable } from './Pressable';
import { HapticKind } from '../util/haptics';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'text';
  disabled?: boolean;
  hapticKind?: HapticKind;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  hapticKind,
  style,
  accessibilityLabel,
}: ButtonProps): React.JSX.Element {
  const { colors } = useTheme();
  const bg =
    variant === 'primary' ? colors.accent : variant === 'secondary' ? colors.surface : 'transparent';
  const fg = variant === 'primary' ? colors.onAccent : colors.ink;
  const border = variant === 'secondary' ? { borderWidth: 1, borderColor: colors.border } : undefined;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hapticKind={hapticKind}
      accessibilityLabel={accessibilityLabel ?? label}
      style={[{ backgroundColor: bg, borderRadius: button.radius, height: button.height,
        alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, opacity: disabled ? 0.5 : 1 }, border, style]}
    >
      <Text style={{ color: fg, fontSize: type.body.size, fontFamily: fontFamilyFor('600') }}>{label}</Text>
    </Pressable>
  );
}

interface IconButtonProps {
  icon: LucideIcon;
  onPress: () => void;
  label: string;
  size?: number;
  dense?: boolean;
  active?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({
  icon: Icon,
  onPress,
  label,
  size,
  dense,
  active,
  disabled,
  style,
}: IconButtonProps): React.JSX.Element {
  const { colors } = useTheme();
  const s = size ?? (dense ? icon.sizeDense : icon.size);
  const target = touchTarget.min;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      style={[
        {
          width: target,
          height: target,
          borderRadius: radius.round,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: active ? colors.accent : 'transparent',
        },
        style,
      ]}
    >
      <Icon
        size={s}
        strokeWidth={icon.strokeWidth}
        color={active ? colors.onAccent : colors.ink}
      />
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.base,
          borderWidth: 1,
          borderColor: colors.border,
          padding: spacing.lg,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Chip({ label, style }: { label: string; style?: StyleProp<ViewStyle> }): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <View
      style={[
        {
          borderRadius: radius.round,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          paddingVertical: spacing.xs,
          paddingHorizontal: spacing.md,
        },
        style,
      ]}
    >
      <Text style={{ color: colors.inkMuted, fontSize: type.caption.size, fontFamily: fontFamilyFor(type.caption.weight) }}>
        {label}
      </Text>
    </View>
  );
}

export function ProgressBar({
  progress,
  style,
}: {
  progress: number; // 0..1
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const { colors } = useTheme();
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <View
      style={[
        {
          height: 4,
          borderRadius: 2,
          backgroundColor: colors.border,
          overflow: 'hidden',
        },
        style,
      ]}
      accessible
      accessibilityLabel={`${Math.round(clamped * 100)} percent`}
    >
      <View
        style={{
          width: `${clamped * 100}%`,
          height: '100%',
          backgroundColor: colors.accent,
          borderRadius: 2,
        }}
      />
    </View>
  );
}
