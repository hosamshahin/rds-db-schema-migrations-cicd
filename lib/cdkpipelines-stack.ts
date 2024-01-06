import { Construct, Stack, StackProps } from '@aws-cdk/core';
import { CodePipeline, CodePipelineSource, CodeBuildStep, ManualApprovalStep } from "@aws-cdk/pipelines";
import { PolicyStatement, Effect } from "@aws-cdk/aws-iam"
import { CdkpipelinesStage } from "./cdkpipelines-stage"

/**
 * The stack that defines the application pipeline
 */
export class CdkpipelinesStack extends Stack {

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const config = this.node.tryGetContext("config")
    const accounts = config['accounts']
    const connectionArn = config['connection_arn']

    const input = CodePipelineSource.connection(
      `${config['githubOrg']}/${config['githubRepo']}`,
      config['githubBranch'],
      { connectionArn }
    )

    const pipeline = new CodePipeline(this, 'Pipeline', {
      pipelineName: 'RDSSchemaMigrationDemo',
      crossAccountKeys: true,
      selfMutation: false,
      synth: new CodeBuildStep('Synth', {
        input,
        env: {
          'CDK_DEVELOPMENT_ACCOUNT': accounts['CICD_ACCOUNT_ID'],
          'CDK_PRODUCTION_ACCOUNT': accounts['PRD_ACCOUNT_ID'],
          'REPOSITORY_NAME': config['githubRepo'],
          'BRANCH': config['githubBranch'],
        },
        commands: [
          'npm ci',
          'npm run build',
          'npm install lib/lambda',
          'npx cdk synth',
        ],
        buildEnvironment: {
          privileged: true // required for the lambda-nodejs module
        }
      })
    });

    // development stage
    const dev = new CdkpipelinesStage(this, 'dev', false, accounts['CICD_ACCOUNT_ID'], {
      env: { account: accounts['CICD_ACCOUNT_ID'], region: this.region }
    });

    pipeline.addStage(dev, {
      post: [this.generateDatabaseSchemaMigration(dev, this.region, this.account)]
    });

    // production stage
    const prod = new CdkpipelinesStage(this, 'prod', true, accounts['CICD_ACCOUNT_ID'], {
      env: {
        account: accounts['PRD_ACCOUNT_ID'],
        region: this.region
      }
    });

    pipeline.addStage(prod, {
      pre: [
        new ManualApprovalStep('ManualApproval', {
          comment: "Approve deployment to production"
        })
      ],
      post: [this.generateDatabaseSchemaMigration(prod, this.region, accounts['PRD_ACCOUNT_ID'])]
    });
  }

  private generateDatabaseSchemaMigration(stage: CdkpipelinesStage, region: string, account: string) {
    const buildCommands: string[] = [];

    const rolePolicyStatements = [
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [`arn:aws:lambda:${region}:${account}:function:${stage.lambdaFunctionName}`],
      })
    ]

    if (stage.stageName === 'prod') {
      // assume cross account role if production environment
      buildCommands.push(
        `aws sts assume-role --role-arn arn:aws:iam::${account}:role/${stage.crossAccountLambdaInvokeRoleName} --role-session-name "CrossAccountSession" > credentials.json`,
        'export AWS_ACCESS_KEY_ID=$(cat credentials.json | jq -r ".Credentials.AccessKeyId")',
        'export AWS_SECRET_ACCESS_KEY=$(cat credentials.json | jq -r ".Credentials.SecretAccessKey")',
        'export AWS_SESSION_TOKEN=$(cat credentials.json | jq -r ".Credentials.SessionToken")'
      )

      // allow to assume role if production environment
      rolePolicyStatements.push(new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: [`arn:aws:iam::${account}:role/${stage.crossAccountLambdaInvokeRoleName}`]
      }))
    }

    // invoke lambda in all environments
    buildCommands.push(
      'aws lambda invoke --function-name $DB_MIGRATE_FUNCTION_NAME out.json --log-type Tail --query LogResult --output text |  base64 -d',
      'lambdaStatus=$(cat out.json | jq ".StatusCode")',
      'if [ $lambdaStatus = 500 ]; then exit 1; else exit 0; fi'
    )

    return new CodeBuildStep(`RDSSchemaUpdate-${stage.stageName}`, {
      env: {
        DB_MIGRATE_FUNCTION_NAME: stage.lambdaFunctionName,
      },
      commands: buildCommands,
      rolePolicyStatements: rolePolicyStatements
    })
  }

}
