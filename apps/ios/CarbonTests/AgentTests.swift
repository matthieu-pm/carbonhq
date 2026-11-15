import XCTest
@testable import Carbon

final class AgentTests: XCTestCase {
    func testGenericAgentsDoNotOfferNativeStancesOrFastMode() {
        XCTAssertFalse(Picks.offersStances("acp:devin"))
        XCTAssertFalse(Picks.honours("acp:devin", "plan"))
        XCTAssertFalse(Picks.offersFast("acp:devin", nil))
        XCTAssertTrue(Picks.offersStances("claude_code"))
        XCTAssertTrue(Picks.honours("codex", "manual"))
        XCTAssertFalse(Picks.honours("codex", "plan"))
    }

    func testGenericPreferencesStayOnTheirServer() {
        let first = UUID()
        let second = UUID()
        XCTAssertNotEqual(Picks.preferenceKey("acp:custom", server: first), Picks.preferenceKey("acp:custom", server: second))
        XCTAssertEqual(Picks.preferenceKey("codex", server: first), Picks.preferenceKey("codex", server: second))
    }

    func testRawAgentOptionsPreserveVendorValuesAndCategories() throws {
        let data = Data(#"[{"id":"thinking","name":"Thinking","category":"thought_level","currentValue":"off","options":[{"value":"off","name":"Off"},{"value":"minimal","name":"Minimal"},{"value":"adaptive","name":"Adaptive"}]},{"id":"vendor-setting","category":"vendor/custom","options":null}]"#.utf8)
        let options = try JSONDecoder().decode([AgentOption].self, from: data)
        XCTAssertEqual(options[0].options.map(\.value), ["off", "minimal", "adaptive"])
        XCTAssertEqual(options[0].value("adaptive"), "adaptive")
        XCTAssertEqual(options[0].value("obsolete"), "off")
        XCTAssertEqual(options[1].category, "vendor/custom")
        XCTAssertEqual(options[1].name, "vendor-setting")
        XCTAssertTrue(options[1].options.isEmpty)
        XCTAssertNil(options[0].pendingValue)
        XCTAssertNil(options[0].rejection)
    }

    func testRejectedPendingChoiceDoesNotReplaceAcknowledgedValue() throws {
        let data = Data(#"{"id":"mode","name":"Mode","currentValue":"code","pendingValue":"plan","rejection":"Plan is unavailable","options":[]}"#.utf8)
        let option = try JSONDecoder().decode(AgentOption.self, from: data)
        XCTAssertEqual(option.currentValue, "code")
        XCTAssertEqual(option.pendingValue, "plan")
        XCTAssertEqual(option.rejection, "Plan is unavailable")
        XCTAssertTrue(option.options.isEmpty)
    }

    func testGenericSessionSurvivesIndexDecoding() throws {
        let data = Data(#"{"sessionId":"s","harness":"acp:future-agent","cwd":"/repo","projectPath":"/repo","title":"Task","model":"vendor/model","permissionMode":"bypassPermissions","status":"completed","modified":"2026-11-15T00:00:00Z","agentConfig":{"thinking":"adaptive"}}"#.utf8)
        let item = try JSONDecoder().decode(SessionItem.self, from: data)
        XCTAssertEqual(item.harness, "acp:future-agent")
        XCTAssertEqual(item.model, "vendor/model")
    }

    func testToolInputUpdatesKeepOneTranscriptRow() throws {
        let data = Data(#"[{"id":"start","sessionId":"s","payload":{"type":"tool_call_started","callId":"call","name":"read_file","toolType":"file_read","input":{}}},{"id":"update","sessionId":"s","payload":{"type":"tool_call_updated","callId":"call","input":{"path":"/repo/main.swift"}}}]"#.utf8)
        let events = try JSONDecoder().decode([AgentEvent].self, from: data)
        let turns = buildTurns(events, busy: true)
        XCTAssertEqual(turns.count, 1)
        XCTAssertEqual(turns[0].work.count, 1)
        guard case .tool(let call) = turns[0].work[0] else { return XCTFail("missing tool") }
        XCTAssertEqual(call.id, "start")
        XCTAssertEqual(call.input["path"]?.string, "/repo/main.swift")
    }
}
