import { Accordion, Table } from "@mantine/core";
import type { PkmEntitySummary } from "@pkm/contracts";

export const EntitySystemInfo = ({
  entity,
}: {
  readonly entity: Pick<
    PkmEntitySummary,
    "id" | "type" | "createdAt" | "updatedAt"
  > &
    Partial<Pick<PkmEntitySummary, "path" | "origin">>;
}): React.JSX.Element => (
  <Accordion.Item value="system">
    <Accordion.Control>システム情報</Accordion.Control>
    <Accordion.Panel>
      <Table>
        <Table.Tbody>
          {(
            [
              ["ID", entity.id],
              ["種別", entity.type],
              ["ファイル", entity.path],
              ["作成日時", entity.createdAt],
              ["更新日時", entity.updatedAt],
              ["Origin", entity.origin],
            ] as const
          )
            .filter(([, value]) => value != null)
            .map(([label, value]) => (
              <Table.Tr key={label}>
                <Table.Th>{label}</Table.Th>
                <Table.Td style={{ overflowWrap: "anywhere" }}>
                  {value}
                </Table.Td>
              </Table.Tr>
            ))}
        </Table.Tbody>
      </Table>
    </Accordion.Panel>
  </Accordion.Item>
);
