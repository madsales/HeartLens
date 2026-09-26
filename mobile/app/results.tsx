import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from "react-native";
import { ResultView } from "../src/components/ResultView";
import { Body, Button, Card } from "../src/components/ui";
import { getHistoryEntry, removeHistoryEntry, type HistoryEntry } from "../src/storage";
import { colors, space } from "../src/theme";

export default function ResultsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [entry, setEntry] = useState<HistoryEntry | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    const lookup = id ? getHistoryEntry(id) : Promise.resolve(null);
    lookup.then((found) => {
      if (active) setEntry(found);
    });
    return () => {
      active = false;
    };
  }, [id]);

  if (entry === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!entry) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Body>This analysis is no longer available.</Body>
          <View style={{ height: space.lg }} />
          <Button title="Back" variant="outline" onPress={() => router.back()} />
        </Card>
      </ScrollView>
    );
  }

  const confirmDelete = () =>
    Alert.alert("Delete this read?", "It will be removed from your history on this device.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await removeHistoryEntry(entry.id);
          router.back();
        },
      },
    ]);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ResultView result={entry.result} model={entry.model} hasConversation={Boolean(entry.input.conversation)} />
      <Button title="Delete from history" variant="danger" onPress={confirmDelete} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: space.lg, paddingBottom: 48 },
});
