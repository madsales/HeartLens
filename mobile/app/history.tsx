import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Body, Button, Card } from "../src/components/ui";
import { clearHistory, getHistory, type HistoryEntry } from "../src/storage";
import { colors, radius, space } from "../src/theme";

function preview(entry: HistoryEntry) {
  const source = entry.input.profile || entry.input.conversation;
  return source.replace(/\s+/g, " ").slice(0, 90);
}

function when(ts: number) {
  return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function HistoryScreen() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useFocusEffect(
    useCallback(() => {
      getHistory().then(setEntries);
    }, []),
  );

  const confirmClear = () =>
    Alert.alert("Clear history?", "All saved reads on this device will be deleted.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: async () => {
          await clearHistory();
          setEntries([]);
        },
      },
    ]);

  if (!entries.length) {
    return (
      <View style={styles.content}>
        <Card>
          <Body>No reads yet. Analyze a profile and it will show up here.</Body>
          <View style={{ height: space.lg }} />
          <Button title="Analyze someone" variant="outline" onPress={() => router.back()} />
        </Card>
      </View>
    );
  }

  return (
    <FlatList
      data={entries}
      keyExtractor={(e) => e.id}
      contentContainerStyle={styles.content}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => router.push({ pathname: "/results", params: { id: item.id } })}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        >
          <Text style={styles.rowTitle} numberOfLines={2}>
            {preview(item) || "(empty)"}
          </Text>
          <Text style={styles.rowMeta}>
            {when(item.createdAt)} · {item.result.engagement.level} · {item.result.opener_angles.length} openers
          </Text>
        </Pressable>
      )}
      ListFooterComponent={
        <View style={styles.footer}>
          <Button title="Clear history" variant="danger" onPress={confirmClear} />
          <Text style={styles.note}>History is stored only on this device.</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: space.lg, paddingBottom: 48 },
  row: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: space.lg,
    marginBottom: space.md,
  },
  rowPressed: { opacity: 0.7 },
  rowTitle: { color: colors.text, fontSize: 16, lineHeight: 22 },
  rowMeta: { color: colors.muted, fontSize: 13, marginTop: 6, textTransform: "capitalize" },
  footer: { marginTop: space.md },
  note: { color: colors.muted, fontSize: 13, textAlign: "center", marginTop: space.md },
});
