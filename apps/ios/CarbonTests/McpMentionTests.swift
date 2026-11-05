import XCTest
@testable import Carbon

final class McpMentionTests: XCTestCase {
    func testPromptMentionsDecodeWithOlderServers() throws {
        for field in ["", #", "mcpServers":null"#, #", "mcpServers":5"#, #", "mcpServers":["linear"]"#] {
            let data = Data(#"{"type":"user_message","text":"use $linear"\#(field)}"#.utf8)
            guard case .userMessage(let text, _, _, _, _, let servers) = try JSONDecoder().decode(Payload.self, from: data)
            else { return XCTFail("not a prompt") }
            XCTAssertEqual(text, "use $linear")
            XCTAssertEqual(servers, field.contains("[\"linear\"]") ? ["linear"] : [])
        }
    }

    func testQueuedMentionsDecodeWithOlderServers() throws {
        for field in ["", #", "mcpServers":["plugin:figma:figma"]"#] {
            let data = Data(#"{"id":"q","text":"use $plugin:figma:figma"\#(field)}"#.utf8)
            let queued = try JSONDecoder().decode(Queued.self, from: data)
            XCTAssertEqual(queued.mcpServers, field.isEmpty ? [] : ["plugin:figma:figma"])
        }
    }
}
