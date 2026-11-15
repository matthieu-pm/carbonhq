import SwiftUI

struct AgentOptionPicker: View {
    let option: AgentOption
    @Binding var value: String

    var body: some View {
        Picker(option.name, selection: $value) {
            if value.isEmpty { Text("Default").tag("") }
            ForEach(option.options, id: \.value) { choice in
                Text(choice.label).tag(choice.value)
            }
        }
    }
}

struct AgentControls: View {
    @Environment(Store.self) private var store
    let key: SessionKey
    let busy: Bool
    @State private var options: [AgentOption] = []
    @State private var showing = false
    @State private var writing = false
    @State private var failure: String?
    @State private var readId = UUID()

    private var connected: Bool { store.serverState[key.server] == .connected }
    private var visible: [AgentOption] { options.filter { $0.isComposerOption && !$0.options.isEmpty } }
    private var harness: String { store.items[key]?.harness ?? "" }

    var body: some View {
        Group {
            if !visible.isEmpty || failure != nil {
                Button { showing = true } label: { Image(systemName: "slider.horizontal.3") }
                    .buttonStyle(IconButtonStyle())
                    .accessibilityLabel("Agent settings")
                    .sheet(isPresented: $showing) { settings }
            } else {
                // EmptyView would never mount the task that discovers these controls.
                Color.clear.frame(width: 0, height: 0)
            }
        }
        .task(id: "\(store.agentOptionsRevision[key.server] ?? 0)|\(busy)|\(connected)") {
            if connected { await load() }
        }
    }

    private var settings: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(visible) { option in
                        AgentOptionPicker(option: option, value: Binding(
                            get: { option.currentValue ?? "" },
                            set: { value in Task { await set(option, value: value) } }
                        ))
                    }
                    .disabled(busy || writing || !connected)
                    if visible.isEmpty && failure == nil { Text("This agent has no settings to change.") }
                } footer: {
                    if busy { Text("Agent settings cannot change during a turn.") }
                }
                .listRowBackground(Theme.card)
                if let failure {
                    Section {
                        Text(sentence(failure)).foregroundStyle(Theme.destructive)
                        Button("Retry") { Task { await load() } }
                            .disabled(!connected || writing)
                    }
                    .listRowBackground(Theme.card)
                }
            }
            .themedList()
            .page()
            .tint(Theme.secondary)
            .navigationTitle("Agent settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { showing = false } }
            }
        }
    }

    private func load() async {
        let request = UUID()
        readId = request
        do {
            let next: [AgentOption] = try await store.call(key.server, "agent_options", [
                "harness": .string(harness), "sessionId": .string(key.id),
            ])
            guard request == readId else { return }
            options = next
            failure = nil
        } catch {
            if request == readId { failure = error.localizedDescription }
        }
    }

    private func set(_ option: AgentOption, value: String) async {
        guard !busy, !writing, connected, option.options.contains(where: { $0.value == value }) else { return }
        writing = true
        failure = nil
        defer { writing = false }
        do {
            _ = try await store.call(key.server, "set_agent_option", [
                "sessionId": .string(key.id), "configId": .string(option.id), "value": .string(value),
            ], as: JSON.self)
            await load()
        } catch {
            failure = error.localizedDescription
        }
    }
}
