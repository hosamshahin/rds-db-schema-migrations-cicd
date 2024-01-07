import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { RdsDbSchemaMigrationsLambda } from './lambda-construct';
import { Database } from './database-construct';

class AppStack extends cdk.Stack {
  public readonly lambdaFunctionName: string;
  public readonly crossAccountLambdaInvokeRoleName: string;

  constructor(scope: Construct, id: string, crossAccount: boolean, devAccountId?: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const database = new Database(this, 'Database', id)
    const service = new RdsDbSchemaMigrationsLambda(this, 'WebService', {
      dbCredentialsSecretName: database.secretName,
      dbCredentialsSecretArn: database.secretArn,
      vpc: database.vpc,
      securityGroup: database.securityGroup,
      defaultDBName: database.defaultDBName,
      crossAccount,
      stageName: id,
      devAccountId
    });

    this.lambdaFunctionName = service.lambdaFunctionName;
    this.crossAccountLambdaInvokeRoleName = service.crossAccountLambdaInvokeRoleName;
  }
}

export class AppStage extends cdk.Stage {
  public readonly lambdaFunctionName: string;
  public readonly crossAccountLambdaInvokeRoleName: string;

  constructor(scope: Construct, id: string, crossAccount: boolean, devAccountId?: string, props?: cdk.StageProps) {
    super(scope, id, props);

    const appStack = new AppStack(this, 'AppStack', crossAccount, devAccountId, props);

    this.lambdaFunctionName = appStack.lambdaFunctionName;
    this.crossAccountLambdaInvokeRoleName = appStack.crossAccountLambdaInvokeRoleName;
  }
}