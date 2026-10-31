import { inject, provide, ref } from 'vue'
import type { InjectionKey, Ref } from 'vue'

/** A project as the app lists it: its id, and the title a reader sees. */
export type ProjectTitle = { project_id: string; title: string }

const PROJECT_TITLES: InjectionKey<Readonly<Ref<readonly ProjectTitle[]>>> =
  Symbol('project-titles')

/**
 * The project list the app already loads, provided once at the root so that a
 * deep surface can name a project without a prop passed through every layer.
 */
export function provideProjectTitles(projects: Readonly<Ref<readonly ProjectTitle[]>>) {
  provide(PROJECT_TITLES, projects)
}

/** The provided list inside a surface that has no provider: empty, so ids show. */
export function useProjectTitles(): Readonly<Ref<readonly ProjectTitle[]>> {
  return inject(PROJECT_TITLES, () => ref<ProjectTitle[]>([]), true)
}

/** The project's title from the list, or its id when the list does not hold it. */
export function projectTitle(projects: readonly ProjectTitle[], projectId: string): string {
  return projects.find((project) => project.project_id === projectId)?.title ?? projectId
}
